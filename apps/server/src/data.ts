import type { GameData } from "@ck/shared";
import buildings from "../../../data/buildings.json";
import characters from "../../../data/characters.json";
import skills from "../../../data/skills.json";
import stages from "../../../data/stages.json";

export const gameData = { buildings, characters, skills, stages } as unknown as GameData;
