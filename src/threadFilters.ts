import type { CommentThread } from "./github.ts";

// Broadly, we want to show two categories of threads:
//  - Unresolved threads
//  - Threads which we have commented on since a given date, and which we have not marked as resolved.

export class ThreadFilters {
    public showAllThreads: boolean = false;
    public showUnresolvedThreads: boolean = true;
    public myLastCommentDate: string | undefined;
    public hideMyResolvedThreads: boolean = true;

    public constructor(public readonly whoami: string | null) {}

    /** Filter the given list of threads, using this filter */
    apply(threads: CommentThread[]): CommentThread[] {
        const myLastCommentDate = this.myLastCommentDate
            ? new Date(this.myLastCommentDate)
            : undefined;

        return threads.filter((t) => {
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
        });
    }
}
