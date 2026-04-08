import type { CommentThread } from "./github.ts";

export class ThreadFilters {
    public showUnresolvedThreads: boolean = true;
    public showOtherUserResolvedThreads: boolean = true;
    public showMyResolvedThreads: boolean = false;
    public myLastCommentDate: string | undefined;

    public constructor(public readonly whoami: String) {}

    /** Filter the given list of threads, using this filter */
    apply(threads: CommentThread[]): CommentThread[] {
        const myLastCommentDate = this.myLastCommentDate
            ? new Date(this.myLastCommentDate)
            : undefined;

        return threads.filter((t) => {
            if (this.showUnresolvedThreads && !t.resolved_by) return true;

            if (
                this.showOtherUserResolvedThreads &&
                t.resolved_by &&
                t.resolved_by.login !== this.whoami
            ) {
                return true;
            }

            if (
                this.showMyResolvedThreads &&
                t.resolved_by?.login === this.whoami
            ) {
                return true;
            }

            if (myLastCommentDate) {
                const idx = t.comments.findIndex(
                    (c) =>
                        c.user.login === this.whoami &&
                        c.created_at >= myLastCommentDate,
                );
                if (idx !== -1) return true;
            }

            return false;
        });
    }
}
