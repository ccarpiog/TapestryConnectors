# XCancel / Nitter connector for Tapestry

A Tapestry connector that subscribes to XCancel / Nitter RSS feeds and
renders them with proper author attribution and media handling.

## Why a dedicated connector?

The generic RSS connector has three shortcomings when pointed at
Nitter-family feeds:

1. **Retweets are mis-attributed.** The feed owner is shown as the
   author for every item, even retweets. The Nitter `<dc:creator>`
   element already contains the *original* author, but the generic
   connector ignores it.
2. **Embedded videos collapse to a plain "Video" link.** Nitter wraps
   videos in `<a href="…/status/…">Video<img src="thumb"/></a>`. Without
   special handling, Tapestry only extracts the thumbnail.
3. **Reply and pinned markers leak into titles.** Prefixes like
   `RT by @foo:`, `R to @bar:`, and `Pinned:` appear verbatim.

This connector fixes all three:

- `item.author` is built from `<dc:creator>` so retweets render under
  the original author. The retweeter is surfaced via an `Annotation`
  (*"Retweet de @username"*).
- Video anchors become a `LinkAttachment` pointing at the status page,
  with the thumbnail as its preview image and a clear
  *"Ver vídeo"* label.
- The `RT by @…:` / `R to @…:` / `Pinned:` prefixes are replaced with
  explicit annotations carrying appropriate SF Symbol icons. Tapestry
  uses the post body (not the RSS `<title>`) as the post text for
  `item_style: "post"`, so those prefixes do not appear in the
  timeline content.

## Configuration

When adding the feed in Tapestry, provide:

| Field | Description |
|-------|-------------|
| URL del feed RSS | Any XCancel or Nitter RSS URL, e.g. `https://xcancel.com/<user>/with_replies/rss`. |
| Ocultar respuestas | Hide items prefixed `R to @…:`. |
| Ocultar retweets | Hide items prefixed `RT by @…:`. |

### XCancel access gate

XCancel is stricter than most Nitter instances:

- It returns `HTTP 403` to curl-style User-Agents.
- It returns `HTTP 400` with the body *"This URL only works inside an
  RSS client."* to **browser** User-Agents.
- It only responds with `HTTP 200` when the request looks like a feed
  reader. This connector therefore sends
  `User-Agent: Tapestry XCancel Connector/1.0`.
- Even with the correct UA, XCancel returns a stub feed titled *"RSS
  reader not yet whitelisted!"* until you email
  `rss@xcancel.com` explaining why you want to read their feeds, and
  include the ID surfaced in the feed body. This connector detects
  the stub and shows the ID in the verification error so you can
  copy–paste it into your email.

Once XCancel has whitelisted the reader, the feed starts returning
real timeline data and the connector behaves normally.

## Compatibility

- Requires Tapestry 1.3 or later (for the promise-based `xmlParse`).
- Works with any Nitter fork whose RSS output follows upstream
  `zedeus/nitter` conventions.

## Known limitations

- Playable video URLs are not available from the RSS alone. Tapping a
  video opens the status page on the origin host, where the video
  plays.
- Retweeted authors do not have per-item avatars (the RSS does not
  carry them). Only feed-owner items show the profile avatar.
