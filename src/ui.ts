import {
    type CommentThread,
    fetchPRData,
    GitHubUser,
    parsePRUrl,
    type PRData,
    type Review,
    type ReviewComment,
} from "./github";
import { ThreadFilters } from "./threadFilters.ts";

function renderResults(data: PRData): string {
    return `
        <div class="results">
            ${renderHeader(data)}
            ${renderStats(data)}
            ${renderReviewSummaries(data.reviews)}
            ${renderThreads(data.whoami, data.threads)}
        </div>
    `;
}

function renderHeader(data: PRData) {
    return `<div class="pr-header">
        <div class="pr-meta">
          <span class="pr-number">#${data.pr.number}</span>
          <span class="pr-state pr-state--${data.pr.state}">${data.pr.state}</span>
        </div>
        <h1 class="pr-title">${escapeHtml(data.pr.title)}</h1>
        <div class="pr-byline">
          ${renderUser(data.pr.user)}
          <span class="pr-date">opened ${formatDate(new Date(data.pr.created_at))}</span>
          <a href="${data.pr.html_url}" target="_blank" rel="noopener" class="gh-link">View on GitHub ↗</a>
        </div>
      </div>`;
}

function renderStats(data: PRData): string {
    const totalComments = data.threads.reduce(
        (sum, t) => sum + t.comments.length,
        0,
    );
    return `      <div class="stats-bar">
        <div class="stat">
          <span class="stat-value">${data.threads.length}</span>
          <span class="stat-label">Threads</span>
        </div>
        <div class="stat">
          <span class="stat-value">${totalComments}</span>
          <span class="stat-label">Comments</span>
        </div>
        <div class="stat">
          <span class="stat-value">${data.reviews.length}</span>
          <span class="stat-label">Reviews</span>
        </div>
      </div>`;
}

function renderReviewSummaries(reviews: Review[]): string {
    // Exclude reviews with no body and where the state is just "COMMENTED": they are fully represented
    // via the comments section.
    const filteredReviews = reviews.filter(
        (r) => r.bodyHTML || r.state !== "COMMENTED",
    );
    if (filteredReviews.length === 0) return "";

    const items = filteredReviews.map(
        (r) => `
      <div class="review-summary">
        <div class="review-summary-header">
          ${renderUser(r.user)}
          ${renderReviewBadge(r.state)}
          <span class="comment-date">${formatDate(new Date(r.submitted_at))}</span>
        </div>
        ${r.bodyHTML ? `<div class="comment-body">${r.bodyHTML}</div>` : ""}
      </div>
    `,
    );

    return `
        <section class="section">
          <h2 class="section-title"><span>Reviews</span><span class="section-count">${filteredReviews.length}</span></h2>
          <div class="reviews-list">${items.join("")}</div>
        </section>
    `;
}

function renderThreads(
    whoami: string,
    threads: CommentThread[],
    threadFilters: ThreadFilters = new ThreadFilters(whoami),
): string {
    if (threads.length === 0)
        return `<div class="empty-state">No inline review comments on this pull request.</div>`;

    const filtered = threadFilters.apply(threads);
    return `
        <section class="section">
          <h2 class="section-title">
            <span>Inline Comments</span>
            <span class="section-count" id="thread-comments-count">${filtered.length}</span>
          </h2>
          ${renderThreadFilters(threadFilters)}
          <div class="threads-list" id="threads-list">${filtered.map(renderThread).join("")}</div>
        </section>
      `;
}

function renderThreadFilters(threadFilters: ThreadFilters): string {
    return `
    <div class="threads-filters">
        <form id="threads-filters-form">
            <div class="threads-filters-row">
                <label for="threads-filters-show-all-threads">Show all threads</label>
                <input type="checkbox" id="threads-filters-show-all-threads" ${threadFilters.showAllThreads ? "checked" : ""} />
            </div>

            <div class="threads-filters-row">
                <label for="threads-filters-show-unresolved-threads">Show unresolved threads</label>
                <input type="checkbox" id="threads-filters-show-unresolved-threads" ${threadFilters.showUnresolvedThreads ? "checked" : ""} />
            </div>

            <div class="threads-filters-row">    
                <label for="threads-filters-my-last-comment">Threads which I have commented on since:</label>
                <input type="text" id="threads-filters-my-last-comment" value="${threadFilters.myLastCommentDate ? escapeHtml(threadFilters.myLastCommentDate) : ""}"
                  placeholder="2026-04-01"/>
                <label>... and which:</label>
            </div>

            <div style="padding-left: 30px">
                <div class="threads-filters-row">
                    <label for="threads-filters-hide-my-resolved-threads">have not been resolved by me</label>
                    <input type="checkbox" id="threads-filters-hide-my-resolved-threads" ${threadFilters.hideMyResolvedThreads ? "checked" : ""} />
                </div>            
            </div>
            
            <div class="threads-filters-row">    
                <input type="submit" value="Update"/>
            </div>
        </form>
    </div>
    `;
}

/** Called after rendering to add listeners to the filters to rerender */
function addFilterChangeHooks(data: PRData): void {
    const callback = () => updateThreadsList(data.whoami, data.threads);
    document.getElementById("threads-filters-form")!.onsubmit = (e) => {
        e.preventDefault();
        callback();
    };
}

/**
 * The callback which is run after the filters are updated.
 *
 * Reads the state of the form, and updates the UI accordingly.
 */
function updateThreadsList(whoami: string, threads: CommentThread[]): void {
    const filter = new ThreadFilters(whoami);

    filter.showAllThreads = (
        document.getElementById(
            "threads-filters-show-all-threads",
        ) as HTMLInputElement
    ).checked;

    filter.showUnresolvedThreads = (
        document.getElementById(
            "threads-filters-show-unresolved-threads",
        ) as HTMLInputElement
    ).checked;

    filter.myLastCommentDate = (
        document.getElementById(
            "threads-filters-my-last-comment",
        ) as HTMLInputElement
    ).value;

    filter.hideMyResolvedThreads = (
        document.getElementById(
            "threads-filters-hide-my-resolved-threads",
        ) as HTMLInputElement
    ).checked;

    const filtered = filter.apply(threads);
    const html = filtered.map(renderThread).join("");
    document.getElementById("threads-list")!.innerHTML = html;
    document.getElementById("thread-comments-count")!.innerText = String(
        filtered.length,
    );

    // TODO: add to query string
}

function renderThread(thread: CommentThread) {
    if (thread.comments.length < 1) return "";

    const firstComment = thread.comments[0];
    const replies = thread.comments.slice(1);
    const repliesHtml = replies.map((r) => renderComment(r, true)).join("");
    const hasReplies = replies.length > 0;

    const resolvedBy = thread.resolved_by
        ? `<div class="thread-resolved">
             <span class="badge badge--approved">✓ Resolved</span>
            ${renderUser(thread.resolved_by)}
        </div>`
        : "";

    const linerange = `:${thread.startLine ? thread.startLine + "-" : ""}${thread.endLine}`;

    const html = `
      <div class="thread">
          <div class="thread-header">
            <span>${escapeHtml(thread.path)}${linerange}</span>
            ${resolvedBy}
          </div>
          ${renderDiffHunk(firstComment.diff_hunk, thread.startLine, thread.endLine)}
          <div class="thread-comments">
            ${renderComment(firstComment)}
            ${hasReplies ? `<div class="thread-replies">${repliesHtml}</div>` : ""}
          </div>
      </div>
    `;
    return html;
}

function formatDate(d: Date): string {
    return d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function renderDiffHunk(
    hunk: string,
    startLine: number | null,
    endLine: number,
): string {
    if (startLine === null) startLine = endLine - 4;
    const lines = hunk.split("\n");

    let leftLineNum = 0;
    let rightLineNum = 0;

    const before: string[] = [];
    const results: string[] = [];

    for (const line of lines) {
        let cls = "diff-line";
        if (line.startsWith("@@")) {
            // meta line
            const metaMatch = line.match(
                "^@@ -([0-9]+),[0-9]+ \\+([0-9]+),[0-9]+ @@",
            );
            if (!metaMatch) {
                console.warn(`Unable to parse meta line ${line}`);
            } else {
                // Subtract 1 from the parsed line numbers. because we'll
                // add 1 again before we actually show the next line.
                leftLineNum = parseInt(metaMatch[1]) - 1;
                rightLineNum = parseInt(metaMatch[2]) - 1;
            }
            cls += " diff-meta";
        } else if (line.startsWith("+")) {
            cls += " diff-add";
            rightLineNum += 1;
        } else if (line.startsWith("-")) {
            cls += " diff-remove";
            leftLineNum += 1;
        } else {
            leftLineNum += 1;
            rightLineNum += 1;
        }

        const formattedLine = `<div class="${cls}">${escapeHtml(line)}</div>`;

        if (rightLineNum < startLine) {
            before.push(formattedLine);
        } else if (startLine <= endLine) {
            results.push(formattedLine);
        }
    }

    const beforeHunk = before.length
        ? `
        <details class="diff-details">
            <summary class="diff-summary">More context</summary>
            ${before.join("")}
        </details>`
        : "";

    return `<div class="diff-hunk">
      ${beforeHunk}
      ${results.join("")}
    </div>`;
}

function renderComment(comment: ReviewComment, isReply = false): string {
    return `
    <div class="comment ${isReply ? "comment--reply" : ""}">
      <div class="comment-header">
        ${renderUser(comment.user)}
        <span class="comment-date">${formatDate(comment.created_at)}</span>
        <a href="${comment.html_url}" target="_blank" rel="noopener" class="comment-link" title="View on GitHub">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M7.775 3.275a.75.75 0 001.06 1.06l1.25-1.25a2 2 0 112.83 2.83l-2.5 2.5a2 2 0 01-2.83 0 .75.75 0 00-1.06 1.06 3.5 3.5 0 004.95 0l2.5-2.5a3.5 3.5 0 00-4.95-4.95l-1.25 1.25zm-4.69 9.64a2 2 0 010-2.83l2.5-2.5a2 2 0 012.83 0 .75.75 0 001.06-1.06 3.5 3.5 0 00-4.95 0l-2.5 2.5a3.5 3.5 0 004.95 4.95l1.25-1.25a.75.75 0 00-1.06-1.06l-1.25 1.25a2 2 0 01-2.83 0z"/></svg>
        </a>
      </div>
      <div class="comment-body">${comment.bodyHTML}</div>
    </div>
  `;
}

function renderUser(user: GitHubUser): string {
    return `
        <a href="${user.html_url}" target="_blank" rel="noopener" class="github-user">
          <img src="${user.avatar_url}&s=40" alt="${escapeHtml(user.login)}" class="avatar" width="20" height="20" />
          <span class="username">${escapeHtml(user.login)}</span>
        </a>`;
}

function renderReviewBadge(state: Review["state"]): string {
    const map: Record<string, { label: string; cls: string }> = {
        APPROVED: { label: "✓ Approved", cls: "badge--approved" },
        CHANGES_REQUESTED: {
            label: "✗ Changes requested",
            cls: "badge--changes",
        },
        COMMENTED: { label: "◎ Commented", cls: "badge--commented" },
        DISMISSED: { label: "⊘ Dismissed", cls: "badge--dismissed" },
        PENDING: { label: "◷ Pending", cls: "badge--pending" },
    };
    const { label, cls } = map[state] ?? { label: state, cls: "" };
    return `<span class="badge ${cls}">${label}</span>`;
}

export function renderApp(root: HTMLElement): void {
    let token = localStorage.getItem("gh_token") ?? "";

    function getHtml(content: string): string {
        return `
      <div class="app">
        <header class="app-header">
          <div class="header-inner">
            <div class="logo">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              <span>PR Review Viewer</span>
            </div>
            <button class="secondary" id="token-toggle">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 5.5l4.5 4.5L10 2.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path fill-rule="evenodd" d="M8 0a8 8 0 100 16A8 8 0 008 0zm0 1.5a6.5 6.5 0 110 13 6.5 6.5 0 010-13z"/></svg>
              ${token ? "🔑 Token set" : "Add token"}
            </button>
          </div>
        </header>

        <main class="app-main">
          <div class="search-section">
            <p class="search-hint">Paste a GitHub Pull Request URL to view all review comments</p>
            <form id="pr-form" class="search-form">
              <div class="input-group">
                <input
                  type="url"
                  id="pr-url"
                  class="pr-input"
                  placeholder="https://github.com/owner/repo/pull/123"
                  autocomplete="off"
                  spellcheck="false"
                />
                <button type="submit" class="fetch-btn">
                  <span>Fetch</span>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
                </button>
              </div>
            </form>
            <div id="token-panel" class="token-panel hidden">
              <label class="token-label">GitHub Personal Access Token <span class="token-hint">(optional — needed for private repos or if rate limited)</span></label>
              <div class="token-row">
                <input type="password" id="token-input" class="token-input" placeholder="ghp_..." value="${escapeHtml(token)}" />
                <button id="token-save" class="token-save-btn">Save</button>
                <button id="token-clear" class="token-clear-btn">Clear</button>
              </div>
            </div>
          </div>

          <div id="output">${content}</div>
        </main>
      </div>
    `;
    }

    function render(content = "", loading = false): void {
        root.innerHTML = getHtml(
            loading
                ? `
      <div class="loading">
        <div class="loading-spinner"></div>
        <span>Fetching review comments…</span>
      </div>
    `
                : content,
        );

        // Restore input value after re-render
        const input = root.querySelector<HTMLInputElement>("#pr-url");
        const urlParam = new URLSearchParams(location.search).get("url");
        if (input && urlParam) input.value = urlParam;

        setupHandlers();
    }

    function setupHandlers(): void {
        const form = root.querySelector<HTMLFormElement>("#pr-form");
        const tokenToggle =
            root.querySelector<HTMLButtonElement>("#token-toggle");
        const tokenPanel = root.querySelector<HTMLDivElement>("#token-panel");
        const tokenSave = root.querySelector<HTMLButtonElement>("#token-save");
        const tokenClear =
            root.querySelector<HTMLButtonElement>("#token-clear");

        tokenToggle?.addEventListener("click", () => {
            tokenPanel?.classList.toggle("hidden");
        });

        tokenSave?.addEventListener("click", () => {
            const val =
                root.querySelector<HTMLInputElement>("#token-input")?.value ??
                "";
            token = val;
            localStorage.setItem("gh_token", val);
            tokenPanel?.classList.add("hidden");
            render();
        });

        tokenClear?.addEventListener("click", () => {
            token = "";
            localStorage.removeItem("gh_token");
            const ti = root.querySelector<HTMLInputElement>("#token-input");
            if (ti) ti.value = "";
        });

        form?.addEventListener("submit", async (e) => {
            e.preventDefault();
            const url =
                root.querySelector<HTMLInputElement>("#pr-url")?.value ?? "";
            const parsed = parsePRUrl(url);
            if (!parsed) {
                root.querySelector("#output")!.innerHTML = `
          <div class="error">
            <strong>Invalid URL.</strong> Please enter a GitHub pull request URL like:<br/>
            <code>https://github.com/owner/repo/pull/123</code>
          </div>
        `;
                return;
            }

            history.replaceState(null, "", `?url=${encodeURIComponent(url)}`);
            render("", true);
            // Re-populate input after loading re-render
            const input = root.querySelector<HTMLInputElement>("#pr-url");
            if (input) input.value = url;

            try {
                const data = await fetchPRData(parsed, token || undefined);
                root.querySelector("#output")!.innerHTML = renderResults(data);
                addFilterChangeHooks(data);
            } catch (err) {
                root.querySelector("#output")!.innerHTML = `
          <div class="error">
            <strong>Error:</strong> ${escapeHtml(err instanceof Error ? err.message : String(err))}
          </div>
        `;
            }
        });
    }

    // Check for URL param on load
    const urlParam = new URLSearchParams(location.search).get("url");
    render();
    if (urlParam) {
        const input = root.querySelector<HTMLInputElement>("#pr-url");
        if (input) {
            input.value = urlParam;
            input.closest("form")?.dispatchEvent(new Event("submit"));
        }
    }
}
