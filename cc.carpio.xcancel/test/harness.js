"use strict";

/**
 * Local Tapestry-host stub to smoke-test plugin.js without Loom.
 *
 * Run with:
 *   node test/harness.js
 *
 * Shims the globals plugin.js depends on (sendRequest, xmlParse,
 * Item/Identity/MediaAttachment/LinkAttachment/Annotation,
 * processResults, processError, processVerification) and exercises
 * both verify() and load() against test/fixture.rss.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const FIXTURE_PATH = path.join(__dirname, "fixture.rss");
const PLUGIN_PATH = path.join(__dirname, "..", "plugin.js");

/**
 * Tiny dependency-free XML parser good enough for RSS 2.0. Mirrors the
 * subset of Tapestry's xmlParse() behavior we rely on: tag text as
 * strings, repeated tags as arrays, and per the Tapestry API docs,
 * namespace prefixes converted from `ns:key` to `ns.key` so consumers
 * access them as `raw["dc.creator"]`. Element attributes are exposed
 * under the documented `name$attrs` sibling key.
 *
 * @param {string} xml XML source text.
 * @returns {Object} Parsed tree.
 */
function miniXmlParse(xml) {
	/**
	 * Converts a colon-prefixed XML tag name to Tapestry's dotted form.
	 * @param {string} raw Raw tag name, e.g. "dc:creator".
	 * @returns {string} Dotted form, e.g. "dc.creator".
	 */
	function ns(raw) {
		return raw.replace(":", ".");
	}
	let i = 0;
	const len = xml.length;

	function skipDecls() {
		while (i < len) {
			if (xml.startsWith("<?", i)) {
				i = xml.indexOf("?>", i);
				i = (i < 0) ? len : i + 2;
			} else if (xml.startsWith("<!--", i)) {
				i = xml.indexOf("-->", i);
				i = (i < 0) ? len : i + 3;
			} else if (xml.startsWith("<!DOCTYPE", i)) {
				i = xml.indexOf(">", i);
				i = (i < 0) ? len : i + 1;
			} else if (/\s/.test(xml[i])) {
				i++;
			} else {
				break;
			}
		}
	}

	function readCDATA() {
		const end = xml.indexOf("]]>", i);
		const data = xml.slice(i, end);
		i = end + 3;
		return data;
	}

	function decodeEntities(s) {
		return s
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.replace(/&#39;/g, "'")
			.replace(/&amp;/g, "&");
	}

	function parseAttrs(attrString) {
		const out = {};
		const attrRe = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
		let m;
		while ((m = attrRe.exec(attrString)) !== null) {
			out[m[1]] = decodeEntities(m[2]);
		}
		return out;
	}

	function parseElement() {
		// Assumes xml[i] === '<' and the next char is a name char.
		i++;
		const nameStart = i;
		while (i < len && !/[\s/>]/.test(xml[i])) i++;
		const rawTagName = xml.slice(nameStart, i);
		const tagName = ns(rawTagName);

		const attrStart = i;
		while (i < len && xml[i] !== ">" && !(xml[i] === "/" && xml[i + 1] === ">")) i++;
		const attrs = parseAttrs(xml.slice(attrStart, i));
		const selfClosing = xml[i] === "/";
		if (selfClosing) i += 2;
		else i++;

		if (selfClosing) {
			return { name: tagName, value: "", attrs: attrs };
		}

		const children = {};
		let text = "";

		while (i < len) {
			if (xml.startsWith("<![CDATA[", i)) {
				i += 9;
				text += readCDATA();
				continue;
			}
			if (xml.startsWith("</", i)) {
				const end = xml.indexOf(">", i);
				i = end + 1;
				break;
			}
			if (xml.startsWith("<!--", i)) {
				i = xml.indexOf("-->", i);
				i = (i < 0) ? len : i + 3;
				continue;
			}
			if (xml[i] === "<") {
				const child = parseElement();
				if (children[child.name] === undefined) {
					children[child.name] = child.value;
				} else if (Array.isArray(children[child.name])) {
					children[child.name].push(child.value);
				} else {
					children[child.name] = [children[child.name], child.value];
				}
				if (child.attrs && Object.keys(child.attrs).length > 0) {
					children[child.name + "$attrs"] = child.attrs;
				}
				continue;
			}
			text += xml[i];
			i++;
		}

		const keys = Object.keys(children);
		if (keys.length === 0) {
			return { name: tagName, value: decodeEntities(text.trim()) };
		}
		const trimmedText = text.trim();
		if (trimmedText) children["#text"] = decodeEntities(trimmedText);
		return { name: tagName, value: children };
	}

	skipDecls();
	const root = parseElement();
	const out = {};
	out[root.name] = root.value;
	return out;
} // End of function miniXmlParse()

// ---- Tapestry host stubs --------------------------------------------------

const fixtureXml = fs.readFileSync(FIXTURE_PATH, "utf8");
const gateXml = fs.readFileSync(path.join(__dirname, "gate-fixture.rss"), "utf8");

global.site = "https://xcancel.com";
global.feedUrl = "https://xcancel.com/sanchezcastejon/with_replies/rss";
global.includeReplies = "on";
global.hideRetweets = "off";

let nextResponse = fixtureXml;
global.sendRequest = function (url, method, params, headers) {
	return Promise.resolve(nextResponse);
};

global.xmlParse = function (text) {
	return Promise.resolve(miniXmlParse(text));
};

class Item {
	static createWithUriDate(uri, date) {
		const i = new Item();
		i.uri = uri;
		i.date = date;
		return i;
	}
}
class Identity {
	static createWithName(name) {
		const id = new Identity();
		id.name = name;
		return id;
	}
	static create(name, username, avatar, uri) {
		const id = new Identity();
		id.name = name;
		id.username = username;
		id.avatar = avatar;
		id.uri = uri;
		return id;
	}
}
class MediaAttachment {
	static createWithUrl(url) {
		const m = new MediaAttachment();
		m.url = url;
		return m;
	}
}
class LinkAttachment {
	static createWithUrl(url) {
		const l = new LinkAttachment();
		l.url = url;
		return l;
	}
}
class Annotation {
	static createWithText(text) {
		const a = new Annotation();
		a.text = text;
		return a;
	}
}
global.Item = Item;
global.Identity = Identity;
global.MediaAttachment = MediaAttachment;
global.LinkAttachment = LinkAttachment;
global.Annotation = Annotation;

let captured = { results: null, error: null, verification: null };
global.processResults = function (items) { captured.results = items; };
global.processError = function (err) { captured.error = err; };
global.processVerification = function (v) { captured.verification = v; };

// ---- Evaluate plugin.js in this context -----------------------------------

const vm = require("vm");
const pluginSrc = fs.readFileSync(PLUGIN_PATH, "utf8");
vm.runInThisContext(pluginSrc, { filename: "plugin.js" });

// ---- Assertions -----------------------------------------------------------

async function run() {
	await verify();
	assert.strictEqual(captured.error, null, "verify() raised: " + (captured.error && captured.error.message));
	assert.ok(captured.verification, "verify() produced no verification object");
	assert.strictEqual(captured.verification.displayName, "Pedro Sánchez / @sanchezcastejon");
	assert.strictEqual(captured.verification.icon, "https://xcancel.com/pic/avatar.jpg");
	assert.ok(captured.verification.accountIdentity, "expected accountIdentity");
	assert.strictEqual(captured.verification.accountIdentity.username, "@sanchezcastejon");

	captured = { results: null, error: null, verification: null };

	await load();
	assert.strictEqual(captured.error, null, "load() raised: " + (captured.error && captured.error.message));
	const items = captured.results;
	assert.ok(Array.isArray(items), "expected an Items array");
	assert.strictEqual(items.length, 5, "expected 5 items, got " + items.length);

	const [pinned, retweet, reply, gif, quote] = items;

	// Pinned
	assert.strictEqual(pinned.author.username, "@sanchezcastejon");
	assert.ok(pinned.annotations && pinned.annotations[0].text === "Fijado",
		"pinned item should be annotated");
	assert.strictEqual(pinned.uri, "https://xcancel.com/sanchezcastejon/status/1111111111111111111",
		"pinned URI should keep origin so the 'open original' action works");

	// Retweet — attribution must be the ORIGINAL author
	assert.strictEqual(retweet.author.username, "@garcbaines1975",
		"retweet author must be the original poster, got " + retweet.author.username);
	assert.ok(retweet.annotations && retweet.annotations[0].text.startsWith("Retweet de @sanchezcastejon"),
		"retweet annotation must name the retweeter");
	// Video in retweet => LinkAttachment with the video thumb as image
	const linkAtt = retweet.attachments.find(a => a instanceof LinkAttachment);
	assert.ok(linkAtt, "retweet with video should have a LinkAttachment");
	assert.strictEqual(linkAtt.image, "https://xcancel.com/pic/thumb-group-photo.jpg");
	assert.ok(linkAtt.url.includes("/status/2045499065136238610"), "link URL should point at the status");
	// The raw "Video" anchor must be gone from the body
	assert.ok(!/>\s*Video\s*</.test(retweet.body), "raw Video anchor leaked into body");
	// dc:creator must not appear as @-prefixed inside body either
	assert.ok(!retweet.body.includes("<img"), "body should not retain <img> when provides_attachments is on");

	// Reply
	assert.strictEqual(reply.author.username, "@sanchezcastejon");
	assert.ok(reply.annotations && reply.annotations[0].text === "En respuesta a @otroUsuario");
	// Two photos => two image attachments
	const imgAtts = reply.attachments.filter(a => a instanceof MediaAttachment && a.mimeType === "image");
	assert.strictEqual(imgAtts.length, 2, "reply should have 2 image attachments");
	// Reply should also carry a LinkAttachment pointing at the conversation
	const convo = reply.attachments.find(a => a instanceof LinkAttachment && a.title === "Ver la conversación");
	assert.ok(convo, "reply should include a conversation LinkAttachment");
	assert.ok(convo.url && convo.url.includes("/status/"), "conversation URL should be the status link");
	assert.strictEqual(convo.subtitle, "Respuesta a @otroUsuario");

	// GIF item
	const gifAtt = gif.attachments.find(a => a instanceof MediaAttachment && (a.mimeType || "").startsWith("video"));
	assert.ok(gifAtt, "gif item should have a video MediaAttachment");
	assert.strictEqual(gifAtt.url, "https://xcancel.com/pic/gif.mp4");
	assert.strictEqual(gifAtt.thumbnail, "https://xcancel.com/pic/gif-thumb.jpg");

	// Quote — should keep the blockquote in body
	assert.ok(/<blockquote>/i.test(quote.body), "quote item should preserve blockquote");

	// resolveFeedUrl URL-shape handling
	const cases = [
		{ url: "https://xcancel.com/user", replies: "on", expect: "https://xcancel.com/user/with_replies/rss" },
		{ url: "https://xcancel.com/user", replies: "off", expect: "https://xcancel.com/user/rss" },
		{ url: "https://xcancel.com/user/", replies: "on", expect: "https://xcancel.com/user/with_replies/rss" },
		{ url: "https://xcancel.com/user/rss", replies: "on", expect: "https://xcancel.com/user/with_replies/rss" },
		{ url: "https://xcancel.com/user/with_replies/rss", replies: "off", expect: "https://xcancel.com/user/rss" },
		{ url: "https://xcancel.com/user/with_replies", replies: "off", expect: "https://xcancel.com/user/rss" },
		// Twitter / X host rewriting
		{ url: "https://twitter.com/user", replies: "on", expect: "https://xcancel.com/user/with_replies/rss" },
		{ url: "https://x.com/user", replies: "on", expect: "https://xcancel.com/user/with_replies/rss" },
		{ url: "https://mobile.twitter.com/user", replies: "off", expect: "https://xcancel.com/user/rss" },
		{ url: "http://www.twitter.com/user", replies: "on", expect: "https://xcancel.com/user/with_replies/rss" },
		// Status URLs collapse to the author's feed
		{ url: "https://twitter.com/user/status/123456", replies: "on", expect: "https://xcancel.com/user/with_replies/rss" },
		{ url: "https://xcancel.com/user/status/123456#m", replies: "off", expect: "https://xcancel.com/user/rss" },
		// Reserved / unrecognized paths pass through
		{ url: "https://xcancel.com/search?q=foo", replies: "on", expect: "https://xcancel.com/search?q=foo" }
	];
	for (const c of cases) {
		global.feedUrl = c.url;
		global.includeReplies = c.replies;
		const got = resolveFeedUrl();
		assert.strictEqual(got, c.expect,
			"resolveFeedUrl(" + c.url + ", replies=" + c.replies + ") => " + got);
	} // End of the loop over URL-shape cases
	global.feedUrl = "https://xcancel.com/sanchezcastejon/with_replies/rss";
	global.includeReplies = "on";

	// Whitelist-gate detection
	captured = { results: null, error: null, verification: null };
	nextResponse = gateXml;
	await verify();
	assert.ok(captured.error, "whitelist gate should produce a verification error");
	assert.ok(/whitelist|lista blanca/i.test(captured.error.message),
		"error message should explain the whitelist step");
	assert.ok(captured.error.message.indexOf("22344d98") >= 0,
		"error message should include the whitelist ID");

	captured = { results: null, error: null, verification: null };
	await load();
	assert.ok(captured.error, "whitelist gate should also fail load()");
	assert.strictEqual(captured.results, null, "no items should be emitted during the gate");

	console.log("OK — all assertions passed for " + items.length + " items (plus gate detection).");
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
