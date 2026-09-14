import { ISelectionCandidate, SelectionKind } from "../selection.js";

export enum IntentAction {
    Mute = "mute",
    Unmute = "unmute",
    Select = "select",
    RequestMuteList = "request_mute_list",
    RequestUnmuteList = "request_unmute_list",
    Status = "status",
    Help = "help",
    Cancel = "cancel",
    Reply = "reply"
}

/*
 What the model is allowed to tell barky to do. Note it only ever chooses *numbers* from a list
 barky gave it - it never names an alert, builds a match expression or computes an instant, so a
 misread can only ever land on something already on the list.
 */
export interface IIntent {
    action: IntentAction;
    numbers: number[];
    all: boolean;
    duration?: string;
    until?: string;
    message?: string;
}

export interface IIntentContext {
    text: string;
    // when a numbered list is already pinned, the reply is read against that list
    pinned?: SelectionKind;
    candidates: ISelectionCandidate[];
}

export interface IIntentResolver {
    resolve(context: IIntentContext): Promise<IIntent>;
    warmUp?(): Promise<void>;
}

export class AiUnavailableError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "AiUnavailableError";
    }
}
