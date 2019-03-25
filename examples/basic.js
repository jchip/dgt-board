var chess = require("chess.js");

var DGT = require("..");
var board = new DGT.Board("COM5");
const protocol = require("../lib/protocol");

var history = [];

var backup;

var game = new chess.Chess();

const pieceByLetter = {
  r: "ROOK",
  n: "KNIGHT",
  b: "BISHOP",
  k: "KING",
  q: "QUEEN",
  p: "PAWN"
};

board.on("ready", function() {
  console.log("Serial No:", board.serialNo);
  console.log("Version:", board.versionNo);
  backup = board.backup();
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
  console.log(board.ascii().join("\n"));
  console.log(game.ascii());
  console.log("-----");
});

board.on("data", function(data) {
  console.log("Field:", data.field);
  console.log("Piece:", data.piece);
  console.log("-----");
});

board.on("changed", function() {
  // console.log("changed:", data.join(""));
  console.log(board.ascii().join("\n"));
  console.log("-----");
  const move = board.findMove(game.turn() === game.WHITE ? "white" : "black", backup);
  if (move) {
    const gameMove = game.move({
      from: protocol.fields[move.from.index],
      to: protocol.fields[move.to.index]
    });
    console.log("board move", move);
    console.log("game move", gameMove);
    if (gameMove) {
      history.push(backup);
      backup = board.backup();
      console.log(game.ascii());
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
