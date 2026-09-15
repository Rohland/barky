export type SelectionKind = "mute" | "unmute";

export interface ISelectionCandidate {
    id: string;      // alert id for a mute, the mute match expression for an unmute
    title: string;
    detail?: string;
}

export interface IPinRequest {
    kind: SelectionKind;
    channel: string;
    threadTs: string;
    userId: string;
    candidates: ISelectionCandidate[];
    // a list drawn from one alert's thread was never a list of everything, so alerts firing
    // elsewhere are not drift worth reporting against it
    scoped?: boolean;
    // a period given when the list was asked for ("mute for 1 hour"), carried so that answering
    // the list does not quietly discard what was already said
    durationMs?: number;
    until?: string;
}

export interface IPinnedSelection extends IPinRequest {
    scoped: boolean;
    expiresAt: Date;
}

/*
 Holds the numbered list of alerts a user was shown, so that their reply resolves against exactly
 what was on screen at the time. New alerts firing in between must not shift the numbering, and
 "all" must never quietly grow to cover something the user never saw.

 State is intentionally in memory only - it is short lived, scoped to a single conversation, and a
 restart losing it simply means the user is told the list expired and is shown a fresh one.
 */
// an expired list is kept a while longer so a late reply can be told it expired, rather than
// being met with "I didn't understand that"
export const DefaultExpiredGraceMs = 30 * 60 * 1000;

export class SelectionStore {

    private readonly _selections = new Map<string, IPinnedSelection>();

    constructor(
        private readonly ttlMs: number,
        private readonly graceMs: number = DefaultExpiredGraceMs) {
    }

    public pin(request: IPinRequest): IPinnedSelection {
        const selection = {
            ...request,
            scoped: request.scoped === true,
            expiresAt: new Date(Date.now() + this.ttlMs)
        };
        this._selections.set(
            SelectionStore.keyFor(request.channel, request.threadTs, request.userId),
            selection);
        return selection;
    }

    public get(
        channel: string,
        threadTs: string,
        userId: string): IPinnedSelection {
        const found = this.peek(channel, threadTs, userId);
        return found && !found.expired ? found.selection : null;
    }

    public peek(
        channel: string,
        threadTs: string,
        userId: string): { selection: IPinnedSelection, expired: boolean } {
        const selection = this._selections.get(SelectionStore.keyFor(channel, threadTs, userId));
        if (!selection) {
            return null;
        }
        return {
            selection,
            expired: selection.expiresAt <= new Date()
        };
    }

    public clear(channel: string, threadTs: string, userId: string) {
        this._selections.delete(SelectionStore.keyFor(channel, threadTs, userId));
    }

    public sweep() {
        const cutoff = Date.now() - this.graceMs;
        for (const [key, selection] of this._selections) {
            if (selection.expiresAt.getTime() <= cutoff) {
                this._selections.delete(key);
            }
        }
    }

    public get size(): number {
        return this._selections.size;
    }

    private static keyFor(channel: string, threadTs: string, userId: string): string {
        return [channel, threadTs, userId].join(":");
    }
}
