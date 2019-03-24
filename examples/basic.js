var DGT = require("..");
var board = new DGT.Board("COM5");

board.on("ready", function() {
  console.log("Serial No:", board.serialNo);
  console.log("Version:", board.versionNo);
  console.log(board._data.join(""));
  console.log("-----");
});

board.on("data", function(data) {
  console.log("Field:", data.field);
  console.log("Piece:", data.piece);
  console.log("-----");
});

board.on("changed", function(data) {
  console.log("changed:", data.join(""));
  console.log("-----");
});

/**
 * TODO:
 */

/*
board.on('end', function(result) {

});
 */
