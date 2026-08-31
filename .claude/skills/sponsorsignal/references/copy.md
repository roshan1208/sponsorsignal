# Writing rules

Everything a visitor reads: the site, the landing pages, the newsletter,
error messages, button labels, meta descriptions.

The test: would a helpful person write this to a friend who is job hunting?

## Rules

**Short sentences.** One idea each. If a sentence has two clauses joined by an
em dash, it is two sentences. Write it as two.

**Plain words.** "We work them out from the employer's name", not "inferred via
heuristic classification". No jargon unless it is the reader's own vocabulary —
"sponsor licence", "Skilled Worker visa" and "A rating" are fine, because that
is what they are searching for.

**Say "employers".** Not "organisations", which is stiff, and not "companies",
which is wrong: much of the register is councils, NHS trusts, schools and
charities. Page titles are the exception — they keep "Companies that sponsor UK
work visas" because that is the phrase people type into Google.

**No hedging or apologising.** "That didn't send. Please try again." Not
"Sorry, unfortunately that did not go through. Please try again in a moment."

**Never explain the implementation.** The visitor does not care that the file
is a few megabytes, that a pipeline runs, or what a README says. "Loading the
list. This takes a few seconds."

**Errors say what happened and what to do.** Nothing else.

**Do not oversell.** "Employers who can sponsor a visa" is true and useful.
"Land your dream UK job today" is not, and this audience has been lied to by
enough visa websites already. Restraint is a competitive advantage here.

## Tells that the text was machine-written

Remove these on sight:

- Em dashes joining clauses, several per paragraph.
- Triples: "clean, tidy and searchable".
- "Simply", "seamlessly", "effortlessly", "unlock", "empower", "leverage",
  "dive into", "in today's fast-paced".
- "It's important to note that", "it's worth mentioning".
- Sentences that restate the previous sentence in different words.
- Bold applied to a whole phrase rather than the thing being emphasised. Bold
  the count, not the verb: `**3 employers** were added`.
- Headings that describe the format instead of the content: "Sample of these
  sponsors" versus "Some of these employers".

## Before and after

| Before | After |
|---|---|
| Loading the full register — this is a few MB, so it can take a moment on a slow connection. | Loading the list. This takes a few seconds. |
| Sorry — that did not go through. Please try again in a moment. | That didn't send. Please try again. |
| You're on the list — first digest coming soon. | You're on the list. We'll email you when new sponsors appear. |
| Industry tags are our own classification, inferred from organisation names, because the official register doesn't include industries. | The official list does not include industries, so we work them out from each employer's name. |
| Generated automatically by SponsorSignal. | Search the full list at https://roshan1208.github.io/sponsorsignal/ |

## Checking

The copy lives in `index.html` and in `pipeline/pages.py` (landing pages) and
`pipeline/refresh.py` (`build_digest`). After changing generated copy,
regenerate the pages and run the tests — several assert on exact strings.

To read the visible homepage copy on its own, strip the tags rather than
scanning the file by eye. It is much easier to hear how it sounds that way.
