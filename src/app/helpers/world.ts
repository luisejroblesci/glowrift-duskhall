import { sortBy } from 'lodash';
import { PRNG } from 'seedrandom';
import {
  GameStateWorld,
  LocationType,
  WorldConfig,
  WorldLocation,
} from '../interfaces';
import { populateLocationWithGuardians } from './guardian';
import {
  gamerng,
  randomChoice,
  randomNumber,
  randomNumberRange,
  uuid,
} from './rng';
import { indexToSprite } from './sprite';
import { gamestate, updateGamestate } from './state-game';
import { distanceBetweenNodes } from './travel';

function fillEmptySpaceWithEmptyNodes(
  config: WorldConfig,
  nodes: Record<string, WorldLocation>,
): void {
  for (let x = 0; x < config.width; x++) {
    for (let y = 0; y < config.height; y++) {
      if (nodes[`${x},${y}`]) continue;

      nodes[`${x},${y}`] = {
        id: uuid(),
        elements: [],
        name: '',
        nodeType: undefined,
        sprite: '',
        objectSprite: '',
        x,
        y,
        claimCount: 0,
        currentlyClaimed: false,
        encounterLevel: 0,
        guardians: [],
      };
    }
  }
}

function addElementsToWorld(nodes: Record<string, WorldLocation>): void {
  Object.values(nodes).forEach((node) => {
    node.elements = [{ element: 'Fire', intensity: 0 }];
  });
}

function getSpriteFromNodeType(nodeType: LocationType | undefined): string {
  switch (nodeType) {
    case 'town':
      return '0021';
    case 'castle':
      return '0000';
    case 'cave':
      return '0020';
    case 'dungeon':
      return '0023';
    case 'village':
      return '0022';
    default:
      return '';
  }
}

function setEncounterLevels(
  config: WorldConfig,
  nodes: Record<string, WorldLocation>,
  middleNode: WorldLocation,
): void {
  const { maxLevel } = config;
  const maxDistance = distanceBetweenNodes(nodes[`0,0`], middleNode);

  Object.values(nodes).forEach((node) => {
    const dist = distanceBetweenNodes(node, middleNode);
    node.encounterLevel = Math.floor((dist / maxDistance) * maxLevel);
  });
}

function determineSpritesForWorld(
  nodes: Record<string, WorldLocation>,
  rng: PRNG,
): void {
  Object.values(nodes).forEach((node) => {
    node.sprite = indexToSprite(16 + randomNumber(4, rng));

    node.objectSprite = getSpriteFromNodeType(node.nodeType);
  });
}

function fillSpacesWithGuardians(nodes: Record<string, WorldLocation>): void {
  Object.values(nodes).forEach((node) => {
    populateLocationWithGuardians(node);
  });
}

export function generateWorld(config: WorldConfig): GameStateWorld {
  const rng = gamerng();

  const nodes: Record<string, WorldLocation> = {};
  const nodeList: WorldLocation[] = [];
  const nodePositionsAvailable: Record<
    string,
    { x: number; y: number; taken: boolean }
  > = {};

  for (let x = 0; x < config.width; x++) {
    for (let y = 0; y < config.height; y++) {
      nodePositionsAvailable[`${x},${y}`] = { x, y, taken: false };
    }
  }

  const findUnusedPosition: () => { x: number; y: number } = () => {
    const freeNodes = Object.values(nodePositionsAvailable).filter(
      (n) => !n.taken,
    );
    if (freeNodes.length === 0) return { x: -1, y: -1 };

    const chosenNode = randomChoice<{ x: number; y: number }>(freeNodes, rng);
    return { x: chosenNode.x, y: chosenNode.y };
  };

  const addNode = (node: WorldLocation): void => {
    nodeList.push(node);
    nodes[`${node.x},${node.y}`] = node;
    nodePositionsAvailable[`${node.x},${node.y}`].taken = true;
  };

  const firstTown: WorldLocation = {
    id: uuid(),
    x: Math.floor(config.width / 2),
    y: Math.floor(config.height / 2),
    nodeType: 'town',
    name: 'LaFlotte',
    elements: [{ element: 'Neutral', intensity: 0 }],
    sprite: '',
    objectSprite: '',
    claimCount: 0,
    currentlyClaimed: true,
    encounterLevel: 0,
    guardians: [],
  };

  addNode(firstTown);

  Object.keys(config.nodeCount).forEach((key) => {
    const count = config.nodeCount[key as LocationType];
    const nodeCount = randomNumberRange(count.min, count.max, rng);

    for (let i = 0; i < nodeCount; i++) {
      const { x, y } = findUnusedPosition();
      const node: WorldLocation = {
        id: uuid(),
        x,
        y,
        nodeType: key as LocationType,
        name: `${key} ${i + 1}`,
        elements: [],
        sprite: '',
        objectSprite: '',
        claimCount: 0,
        currentlyClaimed: false,
        encounterLevel: 0,
        guardians: [],
      };

      addNode(node);
    }
  });

  fillEmptySpaceWithEmptyNodes(config, nodes);
  setEncounterLevels(config, nodes, firstTown);
  addElementsToWorld(nodes);
  fillSpacesWithGuardians(nodes);
  determineSpritesForWorld(nodes, rng);

  return {
    width: config.width,
    height: config.height,
    nodes,
  };
}

export function setWorld(world: GameStateWorld): void {
  updateGamestate((state) => {
    state.world = world;
    return state;
  });
}

export function getWorldNode(x: number, y: number): WorldLocation | undefined {
  return gamestate().world.nodes[`${x},${y}`];
}

export function getCurrentWorldNode(
  state = gamestate(),
): WorldLocation | undefined {
  const currentPosition = state.hero.position;
  return getWorldNode(currentPosition.x, currentPosition.y);
}

export function getAllNodesInOrderOfCloseness(
  node: WorldLocation,
): WorldLocation[] {
  const nodes = Object.values(gamestate().world.nodes);
  return sortBy(nodes, (n) => distanceBetweenNodes(node, n)).filter(
    (n) => n.nodeType && n.id !== node.id,
  );
}

export function getClosestUnclaimedClaimableNode(
  node: WorldLocation,
  nodes = getAllNodesInOrderOfCloseness(node),
): WorldLocation {
  return nodes.filter((n) => !n.currentlyClaimed)[0];
}

export function getNodesWithinRiskTolerance(
  node: WorldLocation,
  nodes = getAllNodesInOrderOfCloseness(node),
): WorldLocation[] {
  const riskTolerance = gamestate().hero.riskTolerance;
  const heroLevel = gamestate().hero.heroes[0].level;

  let levelThreshold = 5;
  if (riskTolerance === 'medium') levelThreshold = 10;
  else if (riskTolerance === 'high') levelThreshold = 100;
  return nodes.filter((n) => n.encounterLevel <= heroLevel + levelThreshold);
}
