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
  return engine;
}

async function initEngine(engine) {
  await engine.init();
  await engine.ucinewgame();
  await engine.isready();
  return engine;
}

async function createStockFishEngine() {
  return await createEngine("stockfish", path.resolve("stockfish_10_x64_bmi2.exe"));
}

async function createAmyanEngine() {
  return await createEngine("amyan", path.resolve("../Engines/Windows/amyan/amyan.exe"));
}

async function createAcquaEngine() {
  return await createEngine("acqua", path.resolve("../Engines/Windows/acqua/acqua.exe"));
}

async function createIrinaEngine() {
  return await createEngine("irina", path.resolve("../Engines/Windows/irina/irina.exe"));
}

// r1b1k2r/ppp3pp/2n5/5p1B/3Pp3/2P5/PP1Q2qP/R3K1NR b KQkq - 1 16

async function createKomodoEngine() {
  return await createEngine(
    "komodo",
    path.resolve("../Engines/Windows/komodo/komodo-9.02-64bit.exe")
  );
}

let amyan, stockfish, acqua, komodo, irina;

async function startChess(board) {
  board = board || (await connectDgtBoard());
  const game = new ChessGame({ board });
  game.newGame(async color => {
    console.log("initializing player", color);
    if (color === "white") {
      return new UserPlayer({ color, game, board });
    } else if (color === "black") {
      // amyan = await initEngine(amyan || (await createAmyanEngine()));
      // acqua = await initEngine(acqua || (await createAcquaEngine()));
      stockfish = await initEngine(stockfish || (await createStockFishEngine()));
      // komodo = await initEngine(komodo || (await createKomodoEngine()));
      irina = await initEngine(irina || (await createIrinaEngine()));
      const engine = [irina, stockfish];
      return new EnginePlayer({ color, game, board, engine });
    }
  });

  return game;
}

module.exports = {
  startChess,
  connectDgtBoard
};

if (require.main === module) {
  startChess();
}
