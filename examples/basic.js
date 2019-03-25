var DGT = require("..");
var board = new DGT.Board("COM5");

var history = [];

var backup;

board.on("ready", function() {
  console.log("Serial No:", board.serialNo);
  console.log("Version:", board.versionNo);
  console.log(board.ascii().join("\n"));
  console.log("-----");
  backup = board.backup();
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
  const move = board.findMove("white", backup);
  if (move) {
    console.log("move", move);
    history.push(backup);
    backup = board.backup();
  }
});

/**
 * TODO:
 */

/*
board.on('end', function(result) {

});
 */
