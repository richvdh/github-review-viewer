import {
    type CommentThread,
    fetchPRData,
    GitHubUser,
    parsePRUrl,
    type PRData,
    replyToReviewThread,
    resolveReviewThread,
    type Review,
    type ReviewComment,
    unresolveReviewThread,
    ReviewCommentReaction,
    REACTIONS,
    addReactionToComment,
} from "./github";
import { ThreadFilters, ThreadSort } from "./threadFilters.ts";

/** Main entry point */
export function renderApp(root: HTMLElement): void {
    updateTokenButton(root);
    setupHandlers(root);

    const urlParam = new URLSearchParams(location.search).get("url");
    if (urlParam) {
        const input = root.querySelector<HTMLInputElement>("#pr-url");
        input!.value = urlParam;
        loadPullRequest(root, urlParam);
    }
}

/** Populate the token button to show whether there is a token set or not */
function updateTokenButton(root: HTMLElement): void {
    const token = getToken();
    const tokenButtonTextElement = root.querySelector("#token-button-text");
    tokenButtonTextElement!.innerHTML = token ? "🔑 Token set" : "Add token";
}

/** Add handlers to the static elements */
function setupHandlers(root: HTMLElement): void {
    const form = root.querySelector<HTMLFormElement>("#pr-form");
    const tokenToggle = root.querySelector<HTMLButtonElement>("#token-toggle");

    tokenToggle!.onclick = () => showTokenPanel(root);

    form?.addEventListener("submit", (e) => {
        e.preventDefault();
        const url =
            root.querySelector<HTMLInputElement>("#pr-url")?.value ?? "";
        loadPullRequest(root, url);
    });

    root.onclick = onClick;
    root.onsubmit = onSubmit;
}

async function loadPullRequest(root: HTMLElement, prURL: string) {
    const parsed = parsePRUrl(prURL);
    if (!parsed) {
        setOutput(`
              <div class="error">
                <strong>Invalid URL.</strong> Please enter a GitHub pull request URL like:<br/>
                <code>https://github.com/owner/repo/pull/123</code>
              </div>
            `);
        return;
    }

    history.replaceState(null, "", `?url=${encodeURIComponent(prURL)}`);

    setOutput(`
          <div class="loading">
            <div class="loading-spinner"></div>
            <span>Fetching review comments…</span>
          </div>
        `);

    // Re-populate input after loading re-render
    const input = root.querySelector<HTMLInputElement>("#pr-url");
    if (input) input.value = prURL;

    try {
        const data = await fetchPRData(parsed, getToken() || undefined);
        setOutput(renderResults(data));
        addFilterChangeHooks(data);
    } catch (err) {
        console.error(err);
        setOutput(`
          <div class="error">
            <strong>Error:</strong> ${escapeHtml(err instanceof Error ? err.message : String(err))}
          </div>
        `);
    }
}

/** Set the content of the `#output` div */
function setOutput(content: string): void {
    document.querySelector("#output")!.innerHTML = content;
}

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
    whoami: string | null,
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
          <div class="threads-list" id="threads-list">${filtered.map((t) => renderThread(t, whoami)).join("")}</div>
        </section>
      `;
}

function renderThreadFilters(threadFilters: ThreadFilters): string {
    const disableMyUserFilters = threadFilters.whoami === null;

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
                <input type="text" id="threads-filters-my-last-comment" placeholder="2026-04-01"
                    value="${threadFilters.myLastCommentDate ? escapeHtml(threadFilters.myLastCommentDate) : ""}" 
                    ${disableMyUserFilters ? "disabled" : ""}
                />
                <button type="button" class="filter-shortcut" id="threads-filters-my-last-review" ${disableMyUserFilters ? "hidden" : ""}>
                    my last review
                </button>
                <label>... and which:</label>
            </div>

            <div style="padding-left: 30px">
                <div class="threads-filters-row">
                    <label for="threads-filters-hide-my-resolved-threads">have not been resolved by me</label>
                    <input type="checkbox" id="threads-filters-hide-my-resolved-threads" 
                         ${threadFilters.hideMyResolvedThreads ? "checked" : ""}
                         ${disableMyUserFilters ? "disabled" : ""}
                    />
                </div>            
            </div>

            <div class="threads-filters-row">
                <label>Sort by: </label>
                <input type="radio" name="sort" id="threads-filters-sort-by-date" value="date"
                    ${threadFilters.sortOrder == ThreadSort.DATE ? "checked" : ""}
                />
                <label for="hreads-filters-sort-by-date">date</label>
                <input type="radio" name="sort" id="threads-filters-sort-by-line" value="line"
                    ${threadFilters.sortOrder == ThreadSort.LINE ? "checked" : ""}
                />
                <label for="hreads-filters-sort-by-line">line</label>
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
    const threadsForm = document.getElementById("threads-filters-form");
    if (!threadsForm) {
        // Form not rendered. Probably no threads in this PR.
        return;
    }

    threadsForm.onsubmit = (e) => {
        e.preventDefault();
        updateThreadsList(data.whoami, data.threads);
    };

    const lastReviewDate = myLastReviewDate(data);
    const lastReviewButton = document.getElementById(
        "threads-filters-my-last-review",
    ) as HTMLButtonElement;
    if (lastReviewDate) {
        lastReviewButton.hidden = false;
        lastReviewButton.onclick = () => {
            (
                document.getElementById(
                    "threads-filters-my-last-comment",
                ) as HTMLInputElement
            ).value = lastReviewDate.toISOString().slice(0, 10);
        };
    } else {
        lastReviewButton.hidden = true;
    }
}

/**
 * The date of the most recent review submitted by the logged-in user, or `null` if there is no such review.
 */
function myLastReviewDate(data: PRData): Date | null {
    if (!data.whoami) return null;

    let latest: Date | null = null;
    for (const r of data.reviews) {
        // Pending reviews have not been submitted, so have no date.
        if (r.user.login !== data.whoami || !r.submitted_at) continue;

        // Only actual review reviews, not just replies to existing comments
        if (r.state === "COMMENTED" && !r.bodyHTML) continue;

        const submitted = new Date(r.submitted_at);
        if (!latest || submitted > latest) latest = submitted;
    }

    return latest;
}

/**
 * The callback which is run after the filters are updated.
 *
 * Reads the state of the form, and updates the UI accordingly.
 */
function updateThreadsList(
    whoami: string | null,
    threads: CommentThread[],
): void {
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

    filter.sortOrder = (
        document.getElementById(
            "threads-filters-sort-by-date",
        ) as HTMLInputElement
    ).checked
        ? ThreadSort.DATE
        : ThreadSort.LINE;

    const filtered = filter.apply(threads);
    const html = filtered.map((t) => renderThread(t, whoami)).join("");
    document.getElementById("threads-list")!.innerHTML = html;
    document.getElementById("thread-comments-count")!.innerText = String(
        filtered.length,
    );

    // TODO: add to query string
}

/** Get a complete thread div, including the outer */
function renderThread(t: CommentThread, whoami: string | null): string {
    return `
        <div class="thread" id="thread-${escapeHtml(t.id)}">
            ${renderThreadInner(t, whoami)}
        </div>
    `;
}

/** Get the inner HTML for a `thread` div */
function renderThreadInner(
    thread: CommentThread,
    whoami: string | null,
): string {
    if (thread.comments.length < 1) return "";

    const firstComment = thread.comments[0];
    const replies = thread.comments.slice(1);
    const repliesHtml = replies
        .map((r) => renderComment(r, whoami, true))
        .join("");

    const resolvedBy = thread.resolved_by
        ? `<div class="thread-resolved">
             <span class="badge badge--approved">✓ Resolved</span>
            ${renderUser(thread.resolved_by)}
        </div>`
        : "";

    const linerange = `:${thread.startLine ? thread.startLine + "-" : ""}${thread.endLine}`;

    const replyControl = thread.canReply
        ? `<div class="thread-buttons">
            <form class="thread-reply-form" data-thread-id="${thread.id}">
                <div class="thread-reply-form-container">
                    <textarea name="reply" placeholder="Reply..." cols="80" rows="3"></textarea>
                    <input name="submit" type="submit" value="Submit"/>
                </div>
            </form>
        </div>`
        : "";

    const buttons: string[] = [];

    if (thread.canResolve) {
        buttons.push(
            `<button type="submit" class="resolve-btn" data-action="resolve" data-thread-id="${thread.id}">Resolve</button>`,
        );
    }

    if (thread.canUnresolve) {
        buttons.push(
            `<button type="submit" class="resolve-btn" data-action="unresolve" data-thread-id="${thread.id}">Unresolve</button>`,
        );
    }

    const html = `
          <div class="thread-header">
            <span>${escapeHtml(thread.path)}${linerange} ${firstComment.commitSHA}</span>
            ${resolvedBy}
          </div>
          ${renderDiffHunk(firstComment.diff_hunk, thread.startLine, thread.endLine)}
          <div class="thread-comments">
            ${renderComment(firstComment, whoami)}
            <div class="thread-replies">${repliesHtml}</div>
          </div>
          ${replyControl}
          ${buttons.length > 0 ? `<div class="thread-buttons">${buttons.join("")}</div>` : ""}
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
        let formattedLine;

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
            formattedLine = `<div class="${cls}">${escapeHtml(line)}</div>`;
        } else {
            let showLeftLineNum = false,
                showRightLineNum = false;

            if (line.startsWith("+")) {
                cls += " diff-add";
                rightLineNum += 1;
                showRightLineNum = true;
            } else if (line.startsWith("-")) {
                cls += " diff-remove";
                leftLineNum += 1;
                showLeftLineNum = true;
            } else {
                leftLineNum += 1;
                rightLineNum += 1;
                showLeftLineNum = showRightLineNum = true;
            }

            formattedLine =
                `<div class="${cls}">` +
                `<span class="diff-linenum">${showLeftLineNum ? leftLineNum : ""}</span>` +
                `<span class="diff-linenum">${showRightLineNum ? rightLineNum : ""}</span>` +
                escapeHtml(line) +
                `</div>`;
        }

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

function renderComment(
    comment: ReviewComment,
    whoami: string | null,
    isReply = false,
): string {
    const badge = comment.isPending ? renderReviewBadge("PENDING") : "";
    return `
    <div class="comment ${isReply ? "comment--reply" : ""}">
      <div class="comment-header">
        ${renderUser(comment.user)}
        <span class="comment-date">${formatDate(comment.created_at)}</span>
        ${badge}
        <a href="${comment.html_url}" target="_blank" rel="noopener" class="comment-link" title="View on GitHub">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M7.775 3.275a.75.75 0 001.06 1.06l1.25-1.25a2 2 0 112.83 2.83l-2.5 2.5a2 2 0 01-2.83 0 .75.75 0 00-1.06 1.06 3.5 3.5 0 004.95 0l2.5-2.5a3.5 3.5 0 00-4.95-4.95l-1.25 1.25zm-4.69 9.64a2 2 0 010-2.83l2.5-2.5a2 2 0 012.83 0 .75.75 0 001.06-1.06 3.5 3.5 0 00-4.95 0l-2.5 2.5a3.5 3.5 0 004.95 4.95l1.25-1.25a.75.75 0 00-1.06-1.06l-1.25 1.25a2 2 0 01-2.83 0z"/></svg>
        </a>
      </div>
      <div class="comment-body">${comment.bodyHTML}</div>
      ${renderCommentReactionsRow(comment, whoami)}
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

/** The row below a comment holding its reaction chips and the reaction picker. */
function renderCommentReactionsRow(
    comment: ReviewComment,
    whoami: string | null,
): string {
    const picker = renderReactionPicker(comment, whoami);
    if (comment.reactions.length === 0 && !picker) return "";
    return `<div class="comment-reactions-row">${renderReactions(comment.reactions)}${picker}</div>`;
}

/** Render a comment's reactions as a row of emoji + reactor-avatar chips. */
function renderReactions(reactions: ReviewCommentReaction[]): string {
    // Group by emoji, preserving first-seen order.
    const groups = new Map<string, GitHubUser[]>();
    for (const r of reactions) {
        const users = groups.get(r.emoji);
        if (users) users.push(r.user);
        else groups.set(r.emoji, [r.user]);
    }

    const chips = [...groups]
        .map(([emoji, users]) => {
            const avatars = users
                .map(
                    (u) =>
                        `<a href="${escapeHtml(u.html_url)}" target="_blank" rel="noopener" title="${escapeHtml(u.login)}">
                           <img src="${escapeHtml(u.avatar_url)}&s=32" alt="${escapeHtml(u.login)}" class="avatar reaction-avatar" width="16" height="16" />
                         </a>`,
                )
                .join("");
            return `<span class="reaction-chip" title="${escapeHtml(users.map((u) => u.login).join(", "))}">
                      <span class="reaction-emoji">${escapeHtml(emoji)}</span>
                      <span class="reaction-users">${avatars}</span>
                    </span>`;
        })
        .join("");

    return `<div class="comment-reactions">${chips}</div>`;
}

/**
 * The reaction picker for a comment. Renders nothing if the viewer cannot react.
 */
function renderReactionPicker(
    comment: ReviewComment,
    whoami: string | null,
): string {
    if (!comment.viewerCanReact) return "";

    const myReactions = new Set(
        comment.reactions
            .filter((r) => r.user.login === whoami)
            .map((r) => r.emoji),
    );

    const buttons = REACTIONS.map((r) => {
        const reacted = myReactions.has(r.emoji);
        return `
            <button type="button" class="reaction-chip reaction-btn" title="${r.label}"
                data-comment-id="${escapeHtml(comment.id)}"
                data-reaction="${r.content}"
                ${reacted ? "disabled" : ""}
            >${r.emoji}</button>`;
    }).join("");

    /* U+263A WHITE SMILING FACE, followed by U+FE0E VARIATION SELECTOR-15,
       which asks for the outline text glyph rather than the colour emoji. */
    return `
        <details class="reaction-picker">
            <summary class="reaction-chip reaction-picker-summary" title="Add a reaction">\u263A\uFE0E＋</summary>
            <div class="reaction-picker-buttons">${buttons}</div>
        </details>`;
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

function showTokenPanel(root: HTMLElement): void {
    const token = getToken();
    const tokenToggle = root.querySelector<HTMLButtonElement>("#token-toggle")!;
    const tokenPanelEl = root.querySelector("#token-panel")!;

    function hideTokenPanel(): void {
        tokenPanelEl.innerHTML = "";
        tokenToggle.onclick = () => showTokenPanel(root);
    }

    tokenPanelEl.innerHTML = `
        <label class="token-label">GitHub Personal Access Token
            <span class="token-hint">
                (optional — needed to access private repos, to
                update reviews, or if rate limited)
            </span>
        </label>
        <div class="token-row">
            <input
                type="password"
                id="token-input"
                class="token-input"
                placeholder="ghp_..."
                value="${token ?? ""}"
            />
            <button id="token-save" class="token-save-btn">
                Save
            </button>
            <button id="token-clear" class="token-clear-btn">
                Clear
            </button>
        </div>
        <p>
            To create a token, go to
            <a
                href="https://github.com/settings/tokens/new"
                target="_"
                >https://github.com/settings/tokens/new
            </a>
            and authenticate. Then select the "repo" scope, and,
            optionally, change the expiration date. Finally,
            click "Generate token". Copy the token from the next
            screen, and paste it here.
        </p>
    `;

    const tokenInput =
        tokenPanelEl.querySelector<HTMLInputElement>("#token-input");
    const tokenSave =
        tokenPanelEl.querySelector<HTMLButtonElement>("#token-save");
    const tokenClear =
        tokenPanelEl.querySelector<HTMLButtonElement>("#token-clear");

    tokenSave!.onclick = () => {
        const val = tokenInput!.value ?? "";
        localStorage.setItem("gh_token", val);
        updateTokenButton(root);
        hideTokenPanel();
        setOutput("");
    };

    tokenClear!.onclick = () => {
        localStorage.removeItem("gh_token");
        tokenInput!.value = "";
    };

    tokenToggle.onclick = () => hideTokenPanel();
}

/** Root-level `click` handler. Handles the resolve/unresolve buttons, and the reaction buttons */
async function onClick(e: PointerEvent): Promise<void> {
    const token = getToken();
    if (!token) return;

    const target = e.target as HTMLElement;

    if (target.classList.contains("resolve-btn")) {
        await onResolveButtonClick(target, token);
    } else if (target.classList.contains("reaction-btn")) {
        await onReactionButtonClick(target, token);
    }
}

async function onResolveButtonClick(target: HTMLElement, token: string) {
    const btn = target as HTMLButtonElement;
    const threadId = btn.dataset.threadId;
    if (!threadId) return;
    const action = btn.dataset.action;

    btn.disabled = true;
    try {
        if (action === "resolve") {
            await resolveReviewThread(threadId, token);
        } else if (action === "unresolve") {
            await unresolveReviewThread(threadId, token);
        }
    } catch (e) {
        btn.disabled = false;
        alert(e);
    }
}

async function onReactionButtonClick(target: HTMLElement, token: string) {
    const btn = target as HTMLButtonElement;
    const commentId = btn.dataset.commentId;

    // Look the reaction up rather than casting, so a bad attribute can't
    // reach the API.
    const reaction = REACTIONS.find((r) => r.content === btn.dataset.reaction);
    if (!commentId || !reaction) return;

    btn.disabled = true;
    try {
        const reactions = await addReactionToComment(
            commentId,
            reaction.content,
            token,
        );
        updateCommentReactions(btn, reactions);
    } catch (e) {
        btn.disabled = false;
        alert(e);
    }
}

/** root-level onsubmit handler. Handles reply forms */
async function onSubmit(e: SubmitEvent): Promise<void> {
    const target = e.target as HTMLFormElement;
    if (target.classList.contains("thread-reply-form")) {
        e.preventDefault();
        const token = getToken();
        if (!token) return;

        const threadId = target.dataset.threadId!;

        const bodyElement = target.elements.namedItem(
            "reply",
        ) as HTMLTextAreaElement;
        const body = bodyElement?.value;
        if (!body) return;

        const submitControl = target.elements.namedItem(
            "submit",
        ) as HTMLInputElement;
        submitControl.disabled = true;

        try {
            const comment = await replyToReviewThread(threadId, body, token);
            addCommentToThread(threadId, comment);
            bodyElement.value = "";
        } catch (e) {
            alert(e);
        } finally {
            submitControl.disabled = false;
        }
    }
}

/** Add a comment to the existing div for a given thread */
function addCommentToThread(threadId: string, comment: ReviewComment): void {
    const threadEl = document.getElementById(`thread-${escapeHtml(threadId)}`);
    if (!threadEl) {
        console.warn(`Unable to find thread ${threadId}`);
        return;
    }

    const repliesEl = threadEl.getElementsByClassName("thread-replies")[0];

    // TODO: populate `whoami` properly. For now it's ok, because a newly-created
    //   comment has no reactions, so the viewer's login is moot.
    repliesEl.append(...htmlToNode(renderComment(comment, null, true)));
}

/**
 * Replace the reaction chips on the comment containing `el`, and close its
 * reaction picker.
 */
function updateCommentReactions(
    el: HTMLElement,
    reactions: ReviewCommentReaction[],
): void {
    const comment = el.closest(".comment");
    if (!comment) return;

    comment.querySelector(".comment-reactions")!.outerHTML =
        renderReactions(reactions);
    comment.querySelector<HTMLDetailsElement>(".reaction-picker")!.open = false;
}

function htmlToNode(html: string): NodeListOf<ChildNode> {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.childNodes;
}

/** Get the current token from local storage */
function getToken(): string | null {
    return localStorage.getItem("gh_token");
}
