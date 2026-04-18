"use strict";

/**
 * XCancel / Nitter connector for Tapestry.
 *
 * Fixes three issues of the generic RSS connector when used against
 * Nitter-family feeds (xcancel.com, nitter.*):
 *  1. Retweets are attributed to the original author (from <dc:creator>)
 *     and the retweeter is surfaced via an Annotation.
 *  2. Embedded videos become a LinkAttachment pointing to the status
 *     page, instead of a bare "Video" text anchor.
 *  3. Replies and pinned posts are annotated and the "R to @x:" /
 *     "Pinned:" prefixes are stripped from the title.
 */

// xcancel.com gates its RSS endpoint: curl-like UAs return HTTP 403,
// and *browser* UAs return HTTP 400 with the body "This URL only works
// inside an RSS client." A feed-reader-style UA is what unlocks a 200
// response.
const FEED_READER_USER_AGENT = "Tapestry XCancel Connector/1.0";

const REQUEST_HEADERS = {
	"User-Agent": FEED_READER_USER_AGENT,
	"Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8"
};

/**
 * Builds the actual RSS URL to fetch from the user-supplied input and
 * the "Incluir respuestas" switch.
 *
 * - Rewrites twitter.com / x.com / mobile.twitter.com hosts to
 *   xcancel.com so users can paste a Twitter URL directly.
 * - Accepts bare profile, /rss, /with_replies, /with_replies/rss,
 *   and /status/<id> shapes and collapses them to the username's
 *   feed with the suffix the switch implies.
 * - Passes through URLs it doesn't recognise (media feeds, searches,
 *   lists, custom Nitter endpoints) so power users aren't blocked.
 *
 * @returns {string} The URL to pass to sendRequest.
 */
function resolveFeedUrl() {
	const raw = (typeof feedUrl === "string" && feedUrl.length > 0) ? feedUrl : site;
	const wantReplies = readSwitch(typeof includeReplies !== "undefined" ? includeReplies : "off");
	const desiredSuffix = wantReplies ? "/with_replies/rss" : "/rss";

	const rewritten = raw.replace(
		/^https?:\/\/(?:mobile\.|www\.)?(?:twitter|x)\.com\//i,
		"https://xcancel.com/"
	);

	const RESERVED = ["i", "search", "settings", "login", "home", "explore",
		"notifications", "messages", "about", "rss"];
	const m = rewritten.match(/^(https?:\/\/[^/]+)\/([A-Za-z0-9_]+)(?:[/?#]|$)/);
	if (m && RESERVED.indexOf(m[2].toLowerCase()) < 0) {
		return m[1] + "/" + m[2] + desiredSuffix;
	}
	return rewritten;
} // End of function resolveFeedUrl()

/**
 * Entry point called when the user adds/edits the feed. Fetches the
 * feed once, validates it is actually Nitter-style RSS, and reports
 * display metadata back to Tapestry.
 */
function verify() {
	const url = resolveFeedUrl();
	return sendRequest(url, "GET", null, REQUEST_HEADERS)
		.then((text) => {
			return xmlParse(text).then((doc) => {
				const channel = extractChannel(doc);
				if (!channel) {
					processError(new Error("La URL no devuelve un RSS válido."));
					return;
				}
				const whitelistError = detectWhitelistGate(channel);
				if (whitelistError) {
					processError(whitelistError);
					return;
				}
				const result = {};
				if (channel.title) {
					result.displayName = stripTags(channel.title).trim();
				}
				if (channel.avatar) {
					result.icon = channel.avatar;
				}
				if (channel.link) {
					result.baseUrl = channel.link;
				}
				const username = parseUsernameFromChannel(channel);
				if (username) {
					const identity = Identity.createWithName(
						result.displayName || ("@" + username)
					);
					identity.username = "@" + username;
					if (channel.avatar) identity.avatar = channel.avatar;
					if (channel.link) identity.uri = channel.link;
					result.accountIdentity = identity;
				}
				processVerification(result);
			});
		})
		.catch((err) => {
			processError(err);
		});
} // End of function verify()

/**
 * Entry point called to refresh the timeline. Fetches the configured
 * feed, parses every <item>, and emits Tapestry Item objects.
 */
function load() {
	const url = resolveFeedUrl();
	return sendRequest(url, "GET", null, REQUEST_HEADERS)
		.then((text) => {
			return xmlParse(text).then((doc) => {
				const channel = extractChannel(doc);
				if (!channel) {
					processError(new Error("El RSS está vacío o no se reconoce el formato."));
					return;
				}
				const whitelistError = detectWhitelistGate(channel);
				if (whitelistError) {
					processError(whitelistError);
					return;
				}
				const items = [];
				for (let i = 0; i < channel.items.length; i++) {
					const raw = channel.items[i];
					const item = buildItem(raw, channel);
					if (item) items.push(item);
				} // End of the loop that builds each Item from the RSS entries
				processResults(items);
			});
		})
		.catch((err) => {
			processError(err);
		});
} // End of function load()

/**
 * Normalizes the parsed XML document into a channel record with a
 * predictable shape. Nitter/XCancel feeds are plain RSS 2.0, but
 * xmlParse exposes namespaced children with dotted keys.
 *
 * @param {Object} doc Parsed XML object returned by xmlParse.
 * @returns {Object|null} { title, link, avatar, items[] } or null.
 */
function extractChannel(doc) {
	if (!doc || !doc.rss || !doc.rss.channel) return null;
	const ch = doc.rss.channel;
	const out = {
		title: pickText(ch.title),
		link: pickText(ch.link),
		avatar: null,
		items: []
	};
	if (ch.image) {
		const img = Array.isArray(ch.image) ? ch.image[0] : ch.image;
		if (img) out.avatar = pickText(img.url);
	}
	const atomAttrs = ch["atom.link$attrs"] || ch["atom:link$attrs"];
	if (atomAttrs) {
		const a = Array.isArray(atomAttrs) ? atomAttrs[0] : atomAttrs;
		if (a && typeof a.href === "string") out.atomLink = a.href;
	}
	let rawItems = ch.item;
	if (!rawItems) rawItems = [];
	if (!Array.isArray(rawItems)) rawItems = [rawItems];
	out.items = rawItems;
	return out;
} // End of function extractChannel()

/**
 * Detects XCancel's "RSS reader not yet whitelisted" stub feed and
 * produces a Spanish-language Error explaining what the user must do
 * (email rss@xcancel.com with the provided ID). Returns null when the
 * feed looks like a normal timeline.
 *
 * @param {Object} channel Normalized channel record.
 * @returns {Error|null} Helpful error, or null if no gate detected.
 */
function detectWhitelistGate(channel) {
	const title = (channel.title || "").toLowerCase();
	if (title.indexOf("not yet whitelisted") < 0 &&
		title.indexOf("whitelist") < 0) return null;
	const desc = (channel.items && channel.items[0])
		? pickText(channel.items[0].description) || ""
		: "";
	const idMatch = desc.match(/[0-9a-f]{64,}/i);
	const id = idMatch ? idMatch[0] : "";
	const msg = "XCancel exige que los lectores RSS estén en su lista blanca." +
		" Envía un correo a rss@xcancel.com explicando por qué quieres leer" +
		" sus feeds e incluye este ID:\n\n" + (id || "(no se pudo extraer el ID; revisa el feed en un navegador)") +
		"\n\nUna vez aprobado, reintenta añadir el feed.";
	return new Error(msg);
} // End of function detectWhitelistGate()

/**
 * Derives the feed-owner Twitter handle from the channel. Falls back
 * to parsing the <atom:link> or <link>.
 *
 * @param {Object} channel Normalized channel record.
 * @returns {string} Username without the leading @, or "".
 */
function parseUsernameFromChannel(channel) {
	if (!channel) return "";
	const candidates = [channel.link, channel.atomLink];
	for (let i = 0; i < candidates.length; i++) {
		const text = candidates[i] || "";
		const m = text.match(/^https?:\/\/[^/]+\/([A-Za-z0-9_]+)(?:[/?#]|$)/);
		if (m) return m[1];
	} // End of the loop over channel link candidates
	return "";
} // End of function parseUsernameFromChannel()

/**
 * Converts one parsed <item> into a Tapestry Item. Applies the
 * retweet/reply/pinned attribution fixes and extracts media as
 * first-class attachments.
 *
 * @param {Object} raw The parsed <item> object.
 * @param {Object} channel Parent channel record (for feed-owner avatar).
 * @returns {Item|null} A configured Item, or null if filtered.
 */
function buildItem(raw, channel) {
	const link = pickText(raw.link) || "";
	const rawTitle = pickText(raw.title) || "";
	const creatorField = pickText(raw["dc:creator"] || raw["dc.creator"]) || "";
	const descriptionHtml = pickText(raw.description) || "";
	const pubDate = pickText(raw.pubDate) || "";
	const guid = pickText(raw.guid) || "";

	const kind = classifyTitle(rawTitle);

	if (kind.type === "retweet" && readSwitch(typeof hideRetweets !== "undefined" ? hideRetweets : "off")) {
		return null;
	}

	const uri = stableUri(link, guid);
	const date = pubDate ? new Date(pubDate) : new Date();
	const item = Item.createWithUriDate(uri, date);

	const authorHandle = creatorField.replace(/^@/, "").trim();
	const isFeedOwner = authorHandle && authorHandle.toLowerCase() ===
		(parseUsernameFromChannel(channel) || "").toLowerCase();
	if (authorHandle) {
		const authorIdentity = Identity.createWithName(
			isFeedOwner ? stripTags(channel.title || "").trim() || ("@" + authorHandle) : ("@" + authorHandle)
		);
		authorIdentity.username = "@" + authorHandle;
		authorIdentity.uri = profileUrlFor(authorHandle, link);
		if (isFeedOwner && channel.avatar) {
			authorIdentity.avatar = channel.avatar;
		}
		item.author = authorIdentity;
	}

	const annotations = [];
	if (kind.type === "retweet") {
		const ann = Annotation.createWithText("Retweet de @" + kind.handle);
		ann.icon = "tapestry.boost.fill";
		if (kind.handle) ann.uri = profileUrlFor(kind.handle, link);
		annotations.push(ann);
	} else if (kind.type === "reply") {
		const ann = Annotation.createWithText("En respuesta a @" + kind.handle);
		ann.icon = "arrowshape.turn.up.left.fill";
		if (kind.handle) ann.uri = profileUrlFor(kind.handle, link);
		annotations.push(ann);
	} else if (kind.type === "pinned") {
		const ann = Annotation.createWithText("Fijado");
		ann.icon = "pin.fill";
		annotations.push(ann);
	}
	if (annotations.length > 0) item.annotations = annotations;

	const extracted = extractMediaAndCleanBody(descriptionHtml, link);
	item.body = extracted.body;

	// The Nitter RSS carries the reply itself but never the parent
	// tweet. The parent only lives on the status page, which XCancel
	// gates behind a JavaScript challenge we cannot solve from
	// sendRequest. Best we can do without extra fetches: surface a
	// link card pointing at the full conversation view.
	if (kind.type === "reply" && link) {
		const convo = LinkAttachment.createWithUrl(link);
		convo.title = "Ver la conversación";
		convo.subtitle = "Respuesta a @" + kind.handle;
		convo.siteName = "XCancel";
		extracted.attachments.push(convo);
	}

	if (extracted.attachments.length > 0) {
		item.attachments = extracted.attachments;
	}

	return item;
} // End of function buildItem()

/**
 * Reads a Tapestry ui-config switch variable safely.
 *
 * @param {string} value "on" or "off".
 * @returns {boolean} True when the switch is flipped on.
 */
function readSwitch(value) {
	return value === "on" || value === true;
} // End of function readSwitch()

/**
 * Returns the per-item URI Tapestry will use for dedup and "open
 * original" actions. Prefers the item <link> (keeps the xcancel origin
 * so opening in a browser works), and strips any trailing #m anchor
 * that nitter adds for media-marked tweets.
 *
 * @param {string} link The per-item <link> URL.
 * @param {string} guid The per-item <guid> value.
 * @returns {string} A stable URI string.
 */
function stableUri(link, guid) {
	if (link) return link.replace(/#m$/, "");
	return guid || "";
} // End of function stableUri()

/**
 * Rewrites a profile URL onto the same host as a reference URL, so
 * images and profiles stay inside the same xcancel/nitter instance.
 *
 * @param {string} handle Twitter handle without "@".
 * @param {string} referenceUrl Any known-good URL from the feed.
 * @returns {string} An absolute profile URL.
 */
function profileUrlFor(handle, referenceUrl) {
	if (!handle) return "";
	try {
		const m = (referenceUrl || "").match(/^(https?:\/\/[^/]+)/);
		const origin = m ? m[1] : "https://xcancel.com";
		return origin + "/" + handle;
	} catch (e) {
		return "https://xcancel.com/" + handle;
	}
} // End of function profileUrlFor()

/**
 * Classifies a Nitter RSS title by its prefix to detect retweets,
 * replies, and pinned posts. Also returns the cleaned title.
 *
 * @param {string} title The raw <title>.
 * @returns {Object} { type, handle, clean }.
 */
function classifyTitle(title) {
	const pinned = title.match(/^Pinned:\s*(.*)$/s);
	if (pinned) return { type: "pinned", handle: "", clean: pinned[1] };
	const rt = title.match(/^RT by @([A-Za-z0-9_]+):\s*(.*)$/s);
	if (rt) return { type: "retweet", handle: rt[1], clean: rt[2] };
	const reply = title.match(/^R to @([A-Za-z0-9_]+):\s*(.*)$/s);
	if (reply) return { type: "reply", handle: reply[1], clean: reply[2] };
	return { type: "post", handle: "", clean: title };
} // End of function classifyTitle()

/**
 * Walks the HTML description to pull out images, GIFs, and videos as
 * Tapestry attachments and returns a cleaned body with no media tags.
 * Video anchors become LinkAttachments so they get a real preview
 * card instead of rendering as the bare text "Video".
 *
 * @param {string} html Raw CDATA HTML from <description>.
 * @param {string} itemLink The item's <link> URL, used as fallback.
 * @returns {Object} { body, attachments }.
 */
function extractMediaAndCleanBody(html, itemLink) {
	const attachments = [];
	let body = html || "";

	// 1) Nitter's "video anchor": an <a> that wraps the literal word
	//    "Video" plus a thumbnail <img>. This must run BEFORE the
	//    generic <img> extractor so the thumbnail doesn't become an
	//    image attachment.
	const videoAnchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	body = body.replace(videoAnchorRe, function (match, href, inner) {
		if (!/\bVideo\b/.test(inner) || !/<img\b/i.test(inner)) return match;
		const thumbMatch = inner.match(/<img\b[^>]*src="([^"]+)"/i);
		const link = LinkAttachment.createWithUrl(href || itemLink);
		link.title = "Ver vídeo";
		link.subtitle = "Contenido de vídeo en el tweet";
		link.type = "video";
		if (thumbMatch) link.image = thumbMatch[1];
		attachments.push(link);
		return "";
	});

	// 2) HTML5 <video> elements (nitter GIFs). Require a nested
	//    <source src="..."> — a posterless, sourceless <video> is
	//    discarded rather than emitted as a broken attachment.
	const htmlVideoRe = /<video\b([^>]*)>([\s\S]*?)<\/video>/gi;
	body = body.replace(htmlVideoRe, function (_m, attrs, inner) {
		const posterMatch = attrs.match(/poster="([^"]*)"/i);
		const sourceMatch = inner.match(/<source\s+[^>]*src="([^"]+)"/i);
		if (!sourceMatch) return "";
		const media = MediaAttachment.createWithUrl(sourceMatch[1]);
		media.mimeType = "video/mp4";
		if (posterMatch) media.thumbnail = posterMatch[1];
		attachments.push(media);
		return "";
	});

	// 3) Plain <img>. Because provides_attachments is true, Tapestry
	//    won't auto-extract these, so we must, and then scrub them.
	const imgRe = /<img\b[^>]*src="([^"]+)"[^>]*\/?>/gi;
	body = body.replace(imgRe, function (_m, src) {
		const media = MediaAttachment.createWithUrl(src);
		media.mimeType = "image";
		attachments.push(media);
		return "";
	});

	// 4) Whitespace cleanup: collapse consecutive <br>, drop empty
	//    paragraphs, trim stray leading/trailing whitespace.
	body = body.replace(/(\s*<br\s*\/?>\s*){2,}/gi, "<br>");
	body = body.replace(/<p>\s*<\/p>/gi, "");
	body = body.replace(/^\s+|\s+$/g, "");

	return { body: body, attachments: attachments };
} // End of function extractMediaAndCleanBody()

/**
 * Pulls plain text out of an xmlParse value that may be a string,
 * a namespace-prefixed object, or an array. xmlParse sometimes
 * returns objects when elements also carry attributes, in which
 * case the text lives under the "#text" or default key.
 *
 * @param {*} value The parsed node.
 * @returns {string} The text content, trimmed of outer whitespace.
 */
function pickText(value) {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return pickText(value[0]);
	if (typeof value === "object") {
		if (typeof value["#text"] === "string") return value["#text"];
		if (typeof value["_"] === "string") return value["_"];
		for (const k in value) {
			if (k.endsWith("$attrs")) continue;
			if (typeof value[k] === "string") return value[k];
		}
	}
	return "";
} // End of function pickText()

/**
 * Strips HTML tags from a string without a DOM parser.
 *
 * @param {string} html HTML input.
 * @returns {string} Text content.
 */
function stripTags(html) {
	if (!html) return "";
	return String(html)
		.replace(/<[^>]*>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, "\"")
		.replace(/&#39;/g, "'");
} // End of function stripTags()
