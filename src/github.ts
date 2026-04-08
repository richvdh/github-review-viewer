import { Octokit } from "@octokit/core";
import {
    paginateGraphQL,
    paginateGraphQLInterface,
} from "@octokit/plugin-paginate-graphql";
import type { Actor, DiffSide, Repository } from "@octokit/graphql-schema";

export interface GitHubUser {
    login: string;
    avatar_url: string;
    html_url: string;
}

export interface ReviewComment {
    user: GitHubUser;
    bodyHTML: string;
    created_at: Date;
    html_url: string;
    diff_hunk: string;
}

export interface Review {
    user: GitHubUser;
    bodyHTML: string;
    state:
        | "APPROVED"
        | "CHANGES_REQUESTED"
        | "COMMENTED"
        | "DISMISSED"
        | "PENDING";
    submitted_at: string;
    html_url: string;
}

export interface PullRequest {
    number: number;
    title: string;
    html_url: string;
    user: GitHubUser;
    state: string;
    created_at: string;
    body: string;
}

export interface ParsedPRUrl {
    owner: string;
    repo: string;
    number: number;
}

export function parsePRUrl(url: string): ParsedPRUrl | null {
    try {
        const u = new URL(url.trim());
        const match = u.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (!match) return null;
        return {
            owner: match[1],
            repo: match[2],
            number: parseInt(match[3], 10),
        };
    } catch {
        return null;
    }
}

async function ghFetch<T>(path: string, token?: string): Promise<T> {
    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`https://api.github.com${path}`, { headers });

    if (!res.ok) {
        if (res.status === 403 || res.status === 429) {
            const remaining = res.headers.get("x-ratelimit-remaining");
            if (remaining === "0") {
                throw new Error(
                    "GitHub API rate limit exceeded. Please provide a Personal Access Token to continue.",
                );
            }
        }
        if (res.status === 404) {
            throw new Error(
                "Pull request not found. Check the URL and ensure the repository is public (or provide a token for private repos).",
            );
        }
        if (res.status === 401) {
            throw new Error(
                "Invalid GitHub token. Please check your Personal Access Token.",
            );
        }
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    return res.json() as Promise<T>;
}

export interface PRData {
    whoami: string;
    pr: PullRequest;
    reviews: Review[];
    threads: CommentThread[];
}

export interface CommentThread {
    comments: ReviewComment[];
    path: string;

    /** The start line in the file to which this thread refers (multi-line only). */
    startLine: number | null;
    /** The side of the diff that the first line of the thread starts on (multi-line only). */
    startDiffSide: DiffSide | null;

    /** The line in the file to which this thread refers. */
    endLine: number;

    /** The side of the diff on which this thread was placed. */
    endDiffSide: DiffSide;

    resolved_by: GitHubUser | null;
}

export async function fetchPRData(
    parsed: ParsedPRUrl,
    token?: string,
): Promise<PRData> {
    const whoami = "richvdh"; // TODO
    const base = `/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`;

    const MyOctokit = Octokit.plugin(paginateGraphQL);
    const octokit = new MyOctokit({ auth: token });

    const [pr, reviews, threads] = await Promise.all([
        ghFetch<PullRequest>(base, token),
        getReviews(octokit, parsed),
        getCommentThreads(octokit, parsed),
    ]);

    return { whoami, pr, reviews, threads };
}

async function getReviews(
    octokit: Octokit & paginateGraphQLInterface,
    parsed: ParsedPRUrl,
): Promise<Review[]> {
    const respIterator = octokit.graphql.paginate.iterator<{
        repository: Repository;
    }>(
        `
        query paginate($cursor: String, $owner: String!, $repo: String!, $prNumber: Int!) {
          repository(owner: $owner, name: $repo){
            pullRequest(number: $prNumber){
              reviews(first: 100, after: $cursor) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  author { login avatarUrl url }
                  bodyHTML
                  state
                  submittedAt
                  url
                }
              }
            }
          }
        }`,
        {
            cursor: "",
            owner: parsed.owner,
            repo: parsed.repo,
            prNumber: parsed.number,
        },
    );

    const result: Review[] = [];
    for await (const resp of respIterator) {
        for (const r of resp.repository.pullRequest!.reviews!.nodes!) {
            const reviewResp = r!;
            result.push({
                user: actorToGithubUser(reviewResp.author!),
                bodyHTML: reviewResp.bodyHTML,
                state: reviewResp.state,
                submitted_at: reviewResp.submittedAt,
                html_url: reviewResp.url,
            });
        }
    }

    return result;
}

async function getCommentThreads(
    octokit: Octokit & paginateGraphQLInterface,
    parsed: ParsedPRUrl,
): Promise<CommentThread[]> {
    const threadIterator = octokit.graphql.paginate.iterator<{
        repository: Repository;
    }>(
        `
        query paginate($cursor: String, $owner: String!, $repo: String!, $prNumber: Int!) {
          repository(owner: $owner, name: $repo){
            pullRequest(number: $prNumber){
              reviewThreads(first: 100, after: $cursor) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  comments(first:100) {
                    nodes {
                      author { login avatarUrl url }
                      bodyHTML
                      createdAt
                      diffHunk
                      url
                    }
                  }
                  diffSide
                  originalLine
                  originalStartLine
                  path
                  resolvedBy { login avatarUrl url }
                  startDiffSide
                }
              }
            }
          }
        }`,
        {
            cursor: "",
            owner: parsed.owner,
            repo: parsed.repo,
            prNumber: parsed.number,
        },
    );

    const result: CommentThread[] = [];
    for await (const resp of threadIterator) {
        for (const t of resp.repository.pullRequest!.reviewThreads.nodes!) {
            const respThread = t!;
            const thread: CommentThread = {
                comments: [],
                path: respThread.path,
                startLine: respThread.originalStartLine ?? null,
                startDiffSide: respThread.startDiffSide ?? null,
                endLine: respThread.originalLine!,
                endDiffSide: respThread.diffSide!,
                resolved_by:
                    (respThread.resolvedBy &&
                        actorToGithubUser(respThread.resolvedBy)) ??
                    null,
            };
            result.push(thread);

            for (const c of respThread.comments.nodes!) {
                const respComment = c!;
                const comment: ReviewComment = {
                    bodyHTML: respComment.bodyHTML,
                    created_at: new Date(respComment.createdAt),
                    diff_hunk: respComment.diffHunk,
                    html_url: respComment.url,
                    user: actorToGithubUser(respComment.author!),
                };
                thread.comments.push(comment);
            }
        }
    }

    return result;
}

/** Convert a GraphQL {@link https://docs.github.com/en/graphql/reference/interfaces#actor|Actor} into a
 * {@link GithubUser}.
 */
function actorToGithubUser(actor: Actor): GitHubUser {
    return {
        avatar_url: actor.avatarUrl,
        html_url: actor.url,
        login: actor.login,
    };
}
