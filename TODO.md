You want to continue reading some Twitter feeds, but you don't want to give money to Elon Musk.

That's why you've been using XCancel's RSS feeds, such as this one:

https://xcancel.com/112canarias/with_replies/rss


And adding them to Tapestry.

However, they don't look as good as they could. And embedded videos
(such as the one here https://xcancel.com/112canarias/status/2045499065136238610#m) only show as a "Video" link in Tapestry.

Also, retweets seem to be written by the person retweeting instead of the original author, such as the one in Screenshot1.png. You could think that it has been created by @garcabaines1975, when it's just a retweet from @sanchezcastejon.

Yo want to create a new connector to process xcancel's feeds (or nitter, I understand they are the same) and show the data withou these issues.

---

## Status — done (2026-04-18)

The new connector lives in `cc.carpio.xcancel/`. Install it by
dragging that folder into Tapestry (desktop) or by following
Tapestry's "Install a Plugin" flow on iOS.

### What it fixes
- **Retweets are attributed to the original author.** The
  `<dc:creator>` in the RSS already carries the original poster's
  handle; the connector uses that for `item.author` and adds an
  `Annotation` (*"Retweet de @username"*) with a boost icon so the
  retweeter remains visible but does not overshadow the author.
- **Embedded videos become a preview card.** The Nitter `<a
  href="/status/…">Video<img src="thumb"/></a>` pattern is converted
  into a `LinkAttachment` (title *"Ver vídeo"*, subtitle *"Contenido
  de vídeo en el tweet"*, thumbnail preserved) that points back to
  the status page on XCancel. GIFs are extracted as proper
  `video/mp4` `MediaAttachment`s.
- **Reply and pinned markers become annotations.** `R to @user:` and
  `Pinned:` title prefixes are replaced with SF-Symbol annotations.
  UI switches let the user hide replies or retweets entirely.
- **Browser User-Agent.** XCancel rejects curl-like clients with HTTP
  403; every request now carries a desktop Safari UA.

### Package contents
- [cc.carpio.xcancel/plugin-config.json](cc.carpio.xcancel/plugin-config.json)
  — `needs_verification`, `verify_variables`, `provides_attachments`,
  `minimum_app_version: "1.3"`.
- [cc.carpio.xcancel/ui-config.json](cc.carpio.xcancel/ui-config.json)
  — feed URL + two hide-switches.
- [cc.carpio.xcancel/plugin.js](cc.carpio.xcancel/plugin.js) —
  `verify()` and `load()` plus the Nitter-aware parser.
- [cc.carpio.xcancel/README.md](cc.carpio.xcancel/README.md) —
  user-facing documentation.
- [cc.carpio.xcancel/test/harness.js](cc.carpio.xcancel/test/harness.js)
  + [cc.carpio.xcancel/test/fixture.rss](cc.carpio.xcancel/test/fixture.rss)
  — offline smoke test: `node test/harness.js` exercises pinned,
  retweet, reply, GIF, and quote items and asserts author
  attribution, annotations, URIs, and attachment types.

### Known limitations
- Videos are not played inline. The RSS only carries the thumbnail
  and a link to the status page; no real MP4/HLS URL is available
  without an extra request. Tapping the card opens XCancel where the
  video plays.
- Per-item avatars are only available for feed-owner posts. Retweeted
  authors show a handle but no avatar (the RSS does not carry one).
- The `User-Agent` override is not formally documented in Tapestry's
  plugin API. Some hardened Nitter instances may still require a
  whitelist request to their operator.
