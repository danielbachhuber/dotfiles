# Copy edit rules

Follow the house style rules in the `## Writing` section of `~/.claude/CLAUDE.md`. Where those
rules and this file disagree, the house style rules win.

## What changes

The revised text is the input, line for line, with only these differences:

- Sentences you rewrote for clarity.
- Words you cut because they did no work.

Every other line stays byte for byte. Same headings, same section order, same list order, same
list markers, same blank lines, same indentation, same table pipes and padding, same frontmatter.

Leave a sentence alone when the only change you would make is swapping one word for a synonym of the
same length. An edit has to earn its place in the diff.

## Line breaks

Keep the input's line breaks exactly.

- A paragraph hard wrapped across several lines stays hard wrapped, broken at the same points.
- A paragraph on one long line stays on one long line.

Never rewrap a paragraph, in either direction. Rewrapping turns a small edit into a diff that touches
every line and hides the real change.

## Edit for clarity

- Cut every word that does no work.
- Prefer the short, plain word over the long or vogue one.
- Use the active voice, with a real actor as the subject.
- Split a sentence that carries two ideas.
- Replace jargon with everyday English when the meaning survives.
- Name the subject of a vague sentence.

## Leave alone

- Anything inside a code span, code block, URL, link text, image, or YAML frontmatter.
- Facts. Add no example, number, name, or claim that is not already in the text.
- Headings, section order, list order, and table structure.
- A sentence that names a function, file, flag, type, or API, unless you are certain your rewrite
  says the same thing. `merges at createAuthClient time` and `merges when it creates createAuthClient`
  are different claims, and the second one is wrong.
- Anything you do not understand. Leave the passage as it is and raise a question instead of guessing.

Cutting a qualifier changes the claim. `two ways to carry one session` and `carry one session` do not
say the same thing. Keep the qualifier unless it is genuinely empty.

The same goes for a clause that says why, or that names the consequence. `the hooks do chain, which is
why they degrade gracefully` becomes a bare fact once you cut the second half. Tighten the wording of
such a clause if you like, but do not delete it.
