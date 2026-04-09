# Github Review Viewer

A single page app which displays Github Pull Request reviews in a more flexible way than the standard Github UI.

## Usage

```
pnpm install
pnpm dev
```
Then visit http://localhost:5173/. Enter the URL of a Github Pull Request and click "Fetch".

## TODO

* Host on Github Pages
* Linting
* Include the filters in the query params
* Line numbers on diffs
* Fix the diff filtering to take into account whether the comment range is on the old or new version of the file
* Allow users to submit comments/replies from the app?
