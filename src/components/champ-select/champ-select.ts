import Vue from "vue";
import Root, { Result } from "../root/root";
import { Component } from "vue-property-decorator";
import { DDRAGON_VERSION, mapBackground, Role } from "../../constants";

import Timer = require("./timer.vue");
import MagicBackground = require("../../static/magic-background.jpg");

export interface ChampSelectMember {
    assignedPosition: Role | "";
    cellId: number;
    championId: number;
    championPickIntent: number;
    displayName: string;
    spell1Id: number;
    spell2Id: number;
}

export interface ChampSelectAction {
    id: number;
    actorCellId: number;
    championId: number;
    completed: boolean;
    type: "ban" | "pick"; // might be more types, only these two are used in conventional queues
}

// A 'turn' is simply an array of actions that happen at the same time.
// In blind pick, this is all the players picking. In draft pick, every
// turn only contains a single action (since no players pick at the same time).
export type ChampSelectTurn = ChampSelectAction[];

export interface ChampSelectTimer {
    phase: "PLANNING" | "BAN_PICK" | "FINALIZATION" | "GAME_STARTING"; // might be more
    isInfinite: boolean;
    adjustedTimeLeftInPhase: number; // time left in ms
}

export interface ChampSelectState {
    actions: ChampSelectTurn[];

    bans: {
        numBans: number;
        myTeamBans: number[];
        theirTeamBans: number[];
    }

    localPlayerCellId: number;
    localPlayer: ChampSelectMember; // added manually, not actually in the payload

    myTeam: ChampSelectMember[];
    theirTeam: ChampSelectMember[];

    timer: ChampSelectTimer;
    trades: {
        id: number;
        cellId: number;
        state: string; // this is an enum.
    }
}

export interface GameflowState {
    map: { id: number };
    gameData: {
        queue: { gameMode: string };
    }
}

@Component({
    components: {
        timer: Timer
    }
})
export default class ChampSelect extends Vue {
    $root: Root;

    state: ChampSelectState | null = null;
    gameflowState: GameflowState | null = null;

    // These two are used to map summoner/champion id -> data.
    championDetails: { id: string, key: string, name: string }[];
    summonerSpellDetails: { id: string, key: string, name: string }[];

    mounted() {
        this.loadStatic("champion.json").then(map => {
            this.championDetails = Object.keys(map.data).map(x => map.data[x]);
        });

        this.loadStatic("summoner.json").then(map => {
            this.summonerSpellDetails = Object.keys(map.data).map(x => map.data[x]);
        });

        // Start observing champion select.
        this.$root.observe("/lol-champ-select/v1/session", this.handleChampSelectChange.bind(this));
    }

    /**
     * Handles a change to the champion select and updates the state appropriately.
     * Note: this cannot be an arrow function for various changes. See the lobby component for more info.
     */
    handleChampSelectChange = async function(this: ChampSelect, result: Result) {
        if (result.status !== 200) {
            this.state = null;
            return;
        }

        const newState: ChampSelectState = result.content;
        newState.localPlayer = newState.myTeam.filter(x => x.cellId === newState.localPlayerCellId)[0];

        // Give enemy summoners obfuscated names.
        newState.theirTeam.forEach((mem, idx) => {
            mem.displayName = "Summoner " + (idx + 1);
        });

        // If we weren't in champ select before, fetch some data.
        if (!this.state) {
            // Gameflow, which contains information about the map and gamemode we are queued up for.
            this.$root.request("/lol-gameflow/v1/session").then(x => {
                x.status === 200 && (this.gameflowState = <GameflowState>x.content);
            });
        }

        this.state = newState;
    };

    /**
     * @returns the map background for the current queue
     */
    get background() {
        if (!this.gameflowState) return "background-image: url(" + MagicBackground + ")";
        return mapBackground(this.gameflowState.map.id);
    }

    /**
     * @returns the current turn happening, or null if no single turn is currently happening (pre and post picks)
     */
    get currentTurn(): ChampSelectTurn | null {
        if (!this.state || this.state.timer.phase !== "BAN_PICK") return null;
        // Find the first set of actions that has at least one not completed.
        return this.state.actions.filter(x => x.filter(y => !y.completed).length > 0)[0];
    }

    /**
     * @returns the member associated with the specified cellId
     */
    memberForCellId(cellId: number): ChampSelectMember {
        if (!this.state) throw new Error("Shouldn't happen");
        return this.state.myTeam.filter(x => x.cellId === cellId)[0] || this.state.theirTeam.filter(x => x.cellId === cellId)[0];
    }

    /**
     * Helper method to load the specified json name from the ddragon static data.
     */
    private loadStatic(filename: string): Promise<any> {
        return new Promise(resolve => {
            const req = new XMLHttpRequest();
            req.onreadystatechange = () => {
                if (req.status !== 200 || !req.responseText || req.readyState !== 4) return;
                const map = JSON.parse(req.responseText);
                resolve(map);
            };
            req.open("GET", "http://ddragon.leagueoflegends.com/cdn/" + DDRAGON_VERSION + "/data/en_GB/" + filename, true);
            req.send();
        });
    }
}