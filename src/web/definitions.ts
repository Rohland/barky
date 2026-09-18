import { ConfigDefinitionSource, IDefinition, IDefinitionSource } from "../chatops/definitions.js";
import { GitPermalinkSource, IPermalinkSource } from "../chatops/permalink.js";
import { getCurrentRules } from "../config.js";
import { log } from "../models/logger.js";

/*
 One alert's definition as the dashboard shows it. Everything but the id is absent when there is
 nothing to show, so found is said outright rather than left to be read off the yaml being there.
 */
export interface IWebDefinition {
    id: string;
    found: boolean;
    // the rules could not be read at all, as opposed to the check not being in them - the two read
    // very differently to someone looking for a check they are sure they declared
    unreadable?: boolean;
    key?: string;
    type?: string;
    displayPath?: string;
    yaml?: string;
    firstLine?: number;
    lastLine?: number;
    variation?: string;
    redacted?: number;
    monitorFor?: string;
    permalink?: string;
}

/*
 The dashboard's side of the definition chat ops gives out in an alert's thread. It answers from the
 same source slack does, so the two cannot disagree about what barky is running.
 */
export class WebDefinitions {

    constructor(
        private readonly definitions: IDefinitionSource,
        private readonly permalinks: IPermalinkSource) {
    }

    public async find(alertId: string): Promise<IWebDefinition> {
        try {
            return await this.describe(alertId);
        } catch (err) {
            // a config file edited mid-read, or yaml that no longer parses. The dashboard can say
            // no more than that there is nothing to show, so the cause is logged here
            log(`web: could not read the configuration for ${ alertId }: ${ err }`, err);
            return { id: alertId, found: false, unreadable: true };
        }
    }

    private async describe(alertId: string): Promise<IWebDefinition> {
        if (!alertId) {
            return { id: null, found: false };
        }
        const definition = this.definitions.find(alertId);
        return definition
            ? await this.asWebDefinition(alertId, definition)
            : { id: alertId, found: false };
    }

    private async asWebDefinition(alertId: string, definition: IDefinition): Promise<IWebDefinition> {
        // filePath is left out on purpose: the dashboard is served to whoever can reach it, and the
        // layout of the box barky runs on is not part of the answer. displayPath is what it shows
        return {
            id: alertId,
            found: true,
            key: definition.key,
            type: definition.type,
            displayPath: definition.displayPath,
            yaml: definition.yaml,
            firstLine: definition.firstLine,
            lastLine: definition.lastLine,
            variation: definition.variation,
            redacted: definition.redacted,
            monitorFor: definition.monitorFor,
            // the whole block is on screen here, unlike in slack, so the link is for editing it
            // rather than for seeing the rest of it
            permalink: await this.permalinks?.forDefinition(definition)
        };
    }
}

let _instance: WebDefinitions = null;

/*
 Both halves are read only and hold nothing per request, so the one instance serves every caller.
 The rules are reached through the accessor rather than captured, because the loop reloads the
 configuration on every pass.
 */
export function getWebDefinitions(): WebDefinitions {
    _instance ??= new WebDefinitions(
        new ConfigDefinitionSource(() => getCurrentRules()),
        new GitPermalinkSource());
    return _instance;
}
