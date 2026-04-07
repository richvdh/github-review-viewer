export interface GitHubUser {
  login: string
  avatar_url: string
  html_url: string
}

export interface ReviewComment {
  id: number
  user: GitHubUser
  body: string
  path: string
  line: number | null
  original_line: number | null
  diff_hunk: string
  created_at: string
  updated_at: string
  html_url: string
  in_reply_to_id?: number
  position: number | null
  commit_id: string
}

export interface Review {
  id: number
  user: GitHubUser
  body: string
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  submitted_at: string
  html_url: string
}

export interface PullRequest {
  number: number
  title: string
  html_url: string
  user: GitHubUser
  state: string
  created_at: string
  body: string
}

export interface ParsedPRUrl {
  owner: string
  repo: string
  number: number
}

export function parsePRUrl(url: string): ParsedPRUrl | null {
  try {
    const u = new URL(url.trim())
    const match = u.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
    if (!match) return null
    return {
      owner: match[1],
      repo: match[2],
      number: parseInt(match[3], 10),
    }
  } catch {
    return null
  }
}

async function ghFetch<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`https://api.github.com${path}`, { headers })

  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining')
      if (remaining === '0') {
        throw new Error('GitHub API rate limit exceeded. Please provide a Personal Access Token to continue.')
      }
    }
    if (res.status === 404) {
      throw new Error('Pull request not found. Check the URL and ensure the repository is public (or provide a token for private repos).')
    }
    if (res.status === 401) {
      throw new Error('Invalid GitHub token. Please check your Personal Access Token.')
    }
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`)
  }

  return res.json() as Promise<T>
}

async function fetchAllPages<T>(path: string, token?: string): Promise<T[]> {
  const results: T[] = []
  let page = 1

  while (true) {
    const separator = path.includes('?') ? '&' : '?'
    const data = await ghFetch<T[]>(`${path}${separator}per_page=100&page=${page}`, token)
    results.push(...data)
    if (data.length < 100) break
    page++
  }

  return results
}

export interface PRData {
  pr: PullRequest
  reviews: Review[]
  comments: ReviewComment[]
}

export async function fetchPRData(parsed: ParsedPRUrl, token?: string): Promise<PRData> {
  const base = `/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`

  const [pr, reviews, comments] = await Promise.all([
    ghFetch<PullRequest>(base, token),
    fetchAllPages<Review>(`${base}/reviews`, token),
    fetchAllPages<ReviewComment>(`${base}/comments`, token),
  ])

  return { pr, reviews, comments }
}

export interface CommentThread {
  root: ReviewComment
  replies: ReviewComment[]
  path: string
  line: number | null
}

export function groupIntoThreads(comments: ReviewComment[]): CommentThread[] {
  const roots = comments.filter(c => !c.in_reply_to_id)
  const replies = comments.filter(c => c.in_reply_to_id)

  return roots.map(root => ({
    root,
    replies: replies.filter(r => r.in_reply_to_id === root.id),
    path: root.path,
    line: root.line ?? root.original_line,
  }))
}
