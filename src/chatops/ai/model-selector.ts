import { AiConfig } from "../config.js";
import { OpenAiClient } from "./openai.js";
import { AiUnavailableError } from "./types.js";
import { log } from "../../models/logger.js";

export interface IModelInfo {
    id: string;
    created?: number;
    shutdown_date?: string;
}

// the models endpoint reports no capability or pricing metadata, so the family has to be read off
// the identifier. These are the shapes that are not chat models at all.
const NonChatMarkers = [
    "embedding", "embed", "tts", "whisper", "audio", "speech", "transcribe",
    "image", "dall-e", "dalle", "moderation", "realtime", "sora", "video",
    "search", "computer-use", "codex", "guard", "rerank", "instruct"
];

// names the cost optimised tier has carried. Picking a number off a short list needs no more than
// this, and if none of them match, the newest chat model is used instead.
const CostTierMarkers = ["nano", "mini", "small", "lite", "luna", "flash"];

function isNonChat(id: string): boolean {
    const lowered = id.toLowerCase();
    return NonChatMarkers.some(marker => lowered.includes(marker));
}

function isDatedSnapshot(id: string): boolean {
    // prefer the moving alias over a pinned snapshot of it
    return /-\d{4}-\d{2}-\d{2}$/.test(id) || /-\d{8}$/.test(id);
}

function byNewestThenName(a: IModelInfo, b: IModelInfo): number {
    const byCreated = (b.created ?? 0) - (a.created ?? 0);
    return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id);
}

/*
 Chooses the model to use from whatever the account actually has access to, so the choice keeps up
 with the lineup instead of being pinned to a name that ages out. Prefers the newest cost optimised
 model, since the job is choosing a number from a short list.
 */
export function selectModel(models: IModelInfo[]): string {
    const candidates = (models ?? [])
        .filter(x => !!x?.id)
        .filter(x => !x.id.startsWith("ft:"))
        .filter(x => !x.shutdown_date)
        .filter(x => !isNonChat(x.id))
        .filter(x => !isDatedSnapshot(x.id));
    if (candidates.length === 0) {
        return null;
    }
    const costOptimised = candidates
        .filter(x => CostTierMarkers.some(marker => x.id.toLowerCase().includes(marker)));
    const pool = costOptimised.length > 0 ? costOptimised : candidates;
    return pool.sort(byNewestThenName)[0].id;
}

export class ModelSelector {

    private _resolved: string;

    constructor(
        private readonly config: AiConfig,
        private readonly client: OpenAiClient) {
    }

    public get resolved(): string {
        return this._resolved;
    }

    /*
     Only successful discovery is cached, so a failed lookup is retried rather than leaving barky
     pinned to a guess.
     */
    public async resolve(): Promise<string> {
        if (this.config.model) {
            return this.config.model;
        }
        if (this._resolved) {
            return this._resolved;
        }
        const models = await this.client.listModels();
        const selected = selectModel(models);
        if (!selected) {
            throw new AiUnavailableError("no suitable model is available to this api key");
        }
        log(`chatops: using ai model '${ selected }', chosen from ${ models.length } available`);
        this._resolved = selected;
        return selected;
    }
}
