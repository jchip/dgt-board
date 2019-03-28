var chess = require("chess.js");
const path = require("path");
var DGT = require("..");
var board = new DGT.Board("COM5");
const protocol = require("../lib/protocol");

const initialPosition = "rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR";

const { Engine } = require("node-uci");

var history = [];

var backup;

var game = new chess.Chess();

var stockfish;
var engineColor;

async function initStockfish() {
  engineColor = "black";
  stockfish = new Engine(path.join(__dirname, "../stockfish_10_x64_bmi2.exe"));
  await stockfish.init();
  // await stockfish.setoption("MultiPV", "4");
  await stockfish.isready();
}

const pieceByLetter = {
  r: "ROOK",
  n: "KNIGHT",
  b: "BISHOP",
  k: "KING",
  q: "QUEEN",
  p: "PAWN"
};

function setupGame() {
  game.clear();
  for (let i = 0; i < backup.length; i++) {
    const p = backup[i];
    if (p !== ".") {
      const lp = p.toLowerCase();
      game.put(
        {
          color: lp === p ? game.BLACK : game.WHITE,
          type: game[pieceByLetter[lp]]
        },
        protocol.fields[i]
      );
    }
  }
}

board.on("ready", async function() {
  console.log("Serial No:", board.serialNo);
  console.log("Version:", board.versionNo);
  backup = board.backup();
  setupGame();
  console.log(board.ascii().join("\n"));
  console.log(game.ascii());
  console.log(game.fen());
  await initStockfish();
  await stockfish.position(game.fen());
  console.log("init stockfish");
  // const result = await stockfish.go({ depth: 15 });
  // console.log(result);
  console.log("-----");
});

board.on("data", function(data) {
  console.log("Field:", data.field);
  console.log("Piece:", data.piece);
  console.log("-----");
});

async function makeEngineMove() {
  const result = await stockfish.go({ depth: 1 });
  const best = result.bestmove;
  console.log("engine move", best);
  // game.move({
  //   from: best.substr(0, 2),
  //   to: best.substr(2)
  // });
  // console.log(game.ascii());
  console.log("---");
}

board.on("changed", async function() {
  // console.log("changed:", data.join(""));
  if (board.toString() === initialPosition) {
    backup = board.backup();
    setupGame();
    return;
  }

  const blackMove = board.findMove("black", backup);
  const whiteMove = board.findMove("white", backup);

  console.log("dgt backup:\n", board.ascii(backup).join("\n"));
  console.log("dgt:\n", board.ascii().join("\n"));
  console.log("-----", board.toString());
  const turnColor = game.turn() === game.WHITE ? "white" : "black";
  const move = board.findMove(turnColor, backup);
  console.log("board move", move, "turn color", turnColor);
  if (move) {
    const gameMove = game.move({
      from: protocol.fields[move.from.index],
      to: protocol.fields[move.to.index]
    });
    console.log("game move", gameMove);
    if (gameMove) {
      history.push(backup);
      backup = board.backup();
      console.log("game\n", game.ascii());
      stockfish.position(game.fen());

      if (turnColor !== engineColor) {
        await makeEngineMove();
      }
      // need to wait for board update on engine moved piece
    }
  }
});

/**
 * TODO:
 */

/*
board.on('end', function(result) {

});
 */
