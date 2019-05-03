"use strict";
const path = require("path");
const ChessGame = require("./lib/chess-game");
const Board = require("./lib/Board");
const UserPlayer = require("./lib/user-player");
const EnginePlayer = require("./lib/engine-player");
const { Engine } = require("node-uci");

async function connectDgtBoard() {
  const board = new Board("COM5");
  return new Promise(resolve => {
    board.once("ready", () => {
      console.log("board ready - serial no:", board.serialNo, "version:", board.versionNo);
      console.log("current positions");
      console.log(board.ascii().join("\n"));
      resolve(board);
    });
  });
}

async function createEngine(name, binaryPath) {
  const engine = new Engine(binaryPath);
  engine.name = name;
  await engine.init();

  return engine;
}

async function initEngine(engine) {
  await engine.ucinewgame();
  await engine.isready();
  return engine;
}

async function createStockFishEngine() {
  return await createEngine("stockfish", path.resolve("stockfish_10_x64_bmi2.exe"));
}

async function createAmyanEngine() {
  return await createEngine("amyan", path.resolve("./Engines/Windows/amyan/amyan.exe"));
}

async function createAcquaEngine() {
  return await createEngine("acqua", path.resolve("./Engines/Windows/acqua/acqua.exe"));
}

async function createIrinaEngine() {
  return await createEngine("irina", path.resolve("./Engines/Windows/irina/irina.exe"));
}

// r1b1k2r/ppp3pp/2n5/5p1B/3Pp3/2P5/PP1Q2qP/R3K1NR b KQkq - 1 16

async function createKomodoEngine() {
  return await createEngine(
    "komodo",
    path.resolve("./Engines/Windows/komodo/komodo-9.02-64bit.exe")
  );
}

let amyan, stockfish, acqua, komodo, irina;

class RandMinTimeEngine extends EnginePlayer {
  constructor(options) {
    super(options);
    this._allowTakeback = Boolean(options.allowTakeback);
  }

  get minTime() {
    return Math.random() * 1000 + 100 + Math.random() * 2000;
  }

  allowTakeback() {
    return this._allowTakeback;
  }
}

async function startChess(game, board, options) {
  board = board || (await connectDgtBoard());
  game = game || new ChessGame({ board });
  game.newGame(
    async color => {
      console.log("initializing player", color);
      if (color === "white") {
        return new UserPlayer(
          Object.assign({ playerInfo: options.whiteInfo }, { color, game, board })
        );
      } else if (color === "black") {
        amyan = await initEngine(amyan || (await createAmyanEngine()));
        // acqua = await initEngine(acqua || (await createAcquaEngine()));
        stockfish = await initEngine(stockfish || (await createStockFishEngine()));
        komodo = await initEngine(komodo || (await createKomodoEngine()));
        irina = await initEngine(irina || (await createIrinaEngine()));
        const engine = [irina, stockfish, komodo, amyan];
        return new RandMinTimeEngine(
          Object.assign(
            {
              allowTakeback: true,
              playerInfo: options.blackInfo
            },
            options,
            {
              color,
              game,
              board,
              engine
            }
          )
        );
      }
    },
    options.startFen,
    options.moves
  );

  return game;
}

module.exports = {
  startChess,
  connectDgtBoard
};

if (require.main === module) {
  startChess();
}
