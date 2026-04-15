# Github Review Viewer

A single page app which displays Github Pull Request reviews in a more flexible way than the standard Github UI.

## Usage

Hosted at https://richvdh.github.io/github-review-viewer.

It is recommended to register a Github access token for use with the application. Doing so avoids rate limiting,
provides access to private repositories, and allows filtering review threads according to whether the user has
interacted with them. To do so, go to https://github.com/settings/tokens/new and create a token with the `repo`
scope. Then, click 'Add token' in the top right of the Github Review Viewer page, and paste in the generated token.

Then, enter the URL of a Github Pull Request and click "Fetch".

## Development

```
pnpm install
pnpm dev
```

## TODO

- Include the filters in the query params
- Line numbers on diffs
- Fix the diff filtering to take into account whether the comment range is on the old or new version of the file
- Better UI updates on resolve
