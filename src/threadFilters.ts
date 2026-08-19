import type { CommentThread } from "./github.ts";

// Broadly, we want to show two categories of threads:
//  - Unresolved threads
//  - Threads which we have commented on since a given date, and which we have not marked as resolved.

export class ThreadFilters {
    public showAllThreads: boolean = false;
    public showUnresolvedThreads: boolean = true;
    public myLastCommentDate: string | undefined;
    public hideMyResolvedThreads: boolean = true;

    public sortOrder: ThreadSort = ThreadSort.LINE;

    public constructor(public readonly whoami: string | null) {}

    /** Filter and sort the given list of threads, using this filter */
    apply(threads: CommentThread[]): CommentThread[] {
        const myLastCommentDate = this.myLastCommentDate
            ? new Date(this.myLastCommentDate)
            : undefined;

        return threads
            .filter((t) => {
                if (this.showAllThreads) return true;

                if (this.showUnresolvedThreads && !t.resolved_by) return true;

                if (this.whoami && myLastCommentDate) {
                    const idx = t.comments.findIndex(
                        (c) =>
                            c.user.login === this.whoami &&
                            c.created_at >= myLastCommentDate,
                    );
                    if (idx !== -1) {
                        if (
                            !this.hideMyResolvedThreads ||
                            t.resolved_by?.login !== this.whoami
                        ) {
                            return true;
                        }
                    }
                }

                return false;
            })
            .sort(
                this.sortOrder == ThreadSort.DATE
                    ? compareThreadsByDate
                    : compareThreadsByLine,
            );
    }
}

function compareThreadsByDate(a: CommentThread, b: CommentThread) {
    return (
        a.comments[0].created_at.getTime() - b.comments[0].created_at.getTime()
    );
}

function compareThreadsByLine(a: CommentThread, b: CommentThread) {
    const aLine = a.startLine ?? a.endLine;
    const bLine = b.startLine ?? b.endLine;
    return aLine - bLine;
}

export enum ThreadSort {
    DATE,
    LINE,
}
