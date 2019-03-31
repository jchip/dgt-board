"use strict";

module.exports = Board;

var util = require("util");
var EventEmitter = require("events").EventEmitter;
var SerialPort = require("serialport");
var protocol = require("./protocol.json");
const _ = require("lodash");
const utils = require("./utils");

//
// table for translating DGT field integer index (0-15) to piece names
//
var pieceByIndex = createPiecesByIndex();

//
// find index of field in linear array by its label, such as a8, b8, etc.
//
var fieldIndex = field => protocol.fields.indexOf(field);

//
// table for translating piece names to single alphabet letter
// rnbqkp for black pieces
// RNBQKP for white pieces
//
var letterByPiece = (() => {
  return Object.keys(protocol.pieces).reduce((x, p) => {
    if (p === "EMPTY") {
      x.EMPTY = ".";
    } else {
      if (p[2] === "N") {
        x[p] = p[2];
      } else {
        x[p] = p[1];
      }
      if (p[0] === "B") {
        x[p] = x[p].toLowerCase();
      }
    }
    return x;
  }, {});
})();

function Board(path, options) {
  this.options = options = Object.assign({ stabilizeDelay: 800 }, options);
  this.changes = [];

  this._serialport = null;
  this._buffer = Buffer.alloc(0);
  this._queue = [];
  this._stabilizeDelay = options.stabilizeDelay;

  this.serialNo = null;
  this.versionNo = null;

  // create new chess logic instance and clear its board
  this._data = new Array(64);
  this._prev = new Array(64);

  // connect to the serialport
  var dgt = new SerialPort(path, {
    baudRate: 9600
  });

  this._serialport = dgt;

  this._stablized = false;

  var stabilizeTimer;

  const start = () => {
    this._stablized = true;
    // wait for serialport being ready
    this._prepareReadyEvent();
  };

  const waitForStabilize = () => {
    if (stabilizeTimer) {
      clearTimeout(stabilizeTimer);
    }
    stabilizeTimer = setTimeout(start, 100);
  };

  dgt.on("data", buf => {
    if (!this._stablized) {
      return waitForStabilize();
    }
    this._buffer = Buffer.concat([this._buffer, buf]);

    var currLength;
    while (this._queue[0] <= this._buffer.length) {
      currLength = this._queue.shift();
      this._queue.shift()(this._buffer.slice(0, currLength));
      this._buffer = this._buffer.slice(currLength);
    }
  });

  dgt.on("open", () => {
    // send reset
    dgt.write(Buffer.from(protocol.commands.DGT_SEND_RESET, "hex"));
    waitForStabilize();
  });
}

/**
 * Make Board an EventEmitter instance.
 */
util.inherits(Board, EventEmitter);

Board.prototype.backup = function(data) {
  data = data || new Array(64);
  for (let i = 0; i < this._data.length; i++) {
    data[i] = this._data[i];
  }

  return data;
};

Board.prototype.toString = function() {
  return this._data.join("");
};

Board.prototype.fen = function() {
  return utils.rawToFen(this._data);
};

/**
 * Read in serial number and version and fire the 'ready' event once finished.
 * Additionally initiates the other events by calling the _setMode() method.
 */
Board.prototype._prepareReadyEvent = function() {
  this.queue(protocol.commands.DGT_RETURN_SERIALNR, 8, data => {
    this.serialNo = data.toString("ascii");

    this.queue(protocol.commands.DGT_SEND_VERSION, 5, data => {
      this.versionNo = data.readInt8(3) + "." + data.readInt8(4);

      this.getBoard(() => {
        this.backup(this._prev);
        this.emit("ready");
        this._setMode();
      });
    });
  });
};

Board.prototype.queue = function(cmd, msgLength, handler) {
  if (!msgLength) {
    msgLength = 0;
    handler = function() {};
  }

  this._queue.push(msgLength, handler);
  if (cmd) {
    this._serialport.write(Buffer.from(cmd, "hex"));
  }
};

Board.prototype.listen = function(msgLength, handler) {
  this.queue(null, msgLength, data => {
    handler(data);
    this.listen(msgLength, handler);
  });
};

Board.prototype.reset = function() {
  this.backup(this._prev);
};

Board.prototype.commit = function() {
  this.backup(this._prev);
};

Board.prototype.getBoard = function(cb) {
  this.queue(protocol.commands.DGT_SEND_BRD, 67, data => {
    var fields = data.slice(3);

    var field;
    for (var i = 0; i < fields.length; i++) {
      field = fields.readInt8(i);
      const piece = pieceByIndex[field];
      if (piece !== undefined) {
        this._data[i] = letterByPiece[piece];
      }
    }

    cb();
  });
};

/**
 * Sets the Update Mode and creates the 'data' events.
 */
Board.prototype._setMode = function() {
  var dgt = this._serialport;

  // set mode
  this.options.mode = this.options.mode || Board.defaults.mode;
  if (!protocol.commands.hasOwnProperty(this.options.mode)) {
    this.options.mode = Board.defaults.mode;
  }
  dgt.write(Buffer.from(protocol.commands[this.options.mode], "hex"));

  this.listen(5, data => {
    var obj = {
      field: protocol.fields[data.readInt8(3)],
      piece: pieceByIndex[data.readInt8(4)]
    };

    this.emit("data", obj);
    this._changed(obj);
  });
};

Board.prototype.setBoard = function(msg) {
  if (msg.id !== "DGT_BOARD_DUMP" || !msg.fields) {
    return false;
  }

  // clear board
  this._data = new Array();

  for (var field in msg.fields) {
    this._data[fieldIndex(field)] = letterByPiece[field];
  }
};

Board.prototype.detectMoves = function() {
  ["black", "white"].forEach(color => {
    const move = this.findMove(color);
    if (move) {
      // emit black_move or white_move
      this.emit(`${color}_move`, move);
    }
  });
};

Board.prototype.processChanges = function() {
  const changes = this.changes;

  this.changes = [];

  changes.forEach(x => {
    const idx = fieldIndex(x.field);
    this._data[idx] = letterByPiece[x.piece];
  });

  this.emit("changed", this._data);

  this.detectMoves();
};

function letterPieceColor(p) {
  return p.toLowerCase() === p ? "black" : "white";
}

// detect piece of color on data that's missing from ref
function findPiecesOnDataOnly(color, data, ref) {
  const dataOnly = [];

  for (let i = 0; i < data.length; i++) {
    const piece = data[i];
    if (piece !== letterByPiece.EMPTY && letterPieceColor(piece) === color && piece !== ref[i]) {
      dataOnly.push({ index: i, piece });
    }
  }

  return dataOnly;
}

Board.prototype.findMove = function(color, prev, curr) {
  prev = prev || this._prev;
  curr = curr || this._data;

  // first detect piece on prev that's missing from curr
  let prevOnly = findPiecesOnDataOnly(color, prev, curr);
  // now detect piece on curr that's missing from prev
  let currOnly = findPiecesOnDataOnly(color, curr, prev);

  // make sure king moves are first to detect castling
  const moveSorter = (a, b) => {
    if (a.piece.toLowerCase() === "k") {
      return -1;
    }
    if (b.piece.toLowerCase() === "k") {
      return 1;
    }
    return a > b ? -1 : 1;
  };

  prevOnly = prevOnly.sort(moveSorter);
  currOnly = currOnly.sort(moveSorter);

  if (
    prevOnly.length === 1 &&
    currOnly.length === 1 &&
    prevOnly[0].piece === currOnly[0].piece &&
    prevOnly[0].index !== currOnly[0].index
  ) {
    return { from: prevOnly[0], to: currOnly[0] };
  }

  // detect castling
  // white king side
  const compoundCastleMoves = [
    // white king side from/to
    [
      [{ piece: "K", index: 60 }, { piece: "R", index: 63 }],
      [{ piece: "K", index: 62 }, { piece: "R", index: 61 }]
    ],
    // white queen side from/to
    [
      [{ piece: "K", index: 60 }, { piece: "R", index: 56 }],
      [{ piece: "K", index: 58 }, { piece: "R", index: 59 }]
    ],
    // black king side from/to
    [
      [{ piece: "K", index: 4 }, { piece: "R", index: 7 }],
      [{ piece: "K", index: 6 }, { piece: "R", index: 5 }]
    ],
    // black queen side from/to
    [
      [{ piece: "K", index: 4 }, { piece: "R", index: 0 }],
      [{ piece: "K", index: 2 }, { piece: "R", index: 3 }]
    ]
  ];

  if (compoundCastleMoves.find(c => _.isEqual(c[0], prevOnly) && _.isEqual(c[1], currOnly))) {
    return { from: prevOnly[0], to: currOnly[0] };
  }

  // TODO: detect pawn promoting

  // TODO: alert about irregular changes

  return false;
};

Board.prototype._changed = function(curr) {
  if (this.changeTimer) {
    clearTimeout(this.changeTimer);
    this.changeTimer = null;
  }

  this.changes.push(curr);

  this.changeTimer = setTimeout(() => {
    this.changeTimer = null;
    this.processChanges();
  }, this._stabilizeDelay);
};

Board.prototype.ascii = function(data) {
  data = data || this._data;
  const out = ["   +------------------------+"];
  for (let i = 0; i < 8; i++) {
    const row = data.slice(i * 8, i * 8 + 8).join("  ");
    out.push(` ${8 - i} | ${row} |`);
  }
  out.push("   +------------------------+");
  out.push("     a  b  c  d  e  f  g  h");
  return out;
};

/**
 * Some defaults.
 * @type {Object}
 */
Board.defaults = {
  mode: "DGT_SEND_UPDATE_BRD"
};

/*
Board.prototype.createRepl = function() {
  function runCommand(cmd) {
    if (Object.hasKey(protocol.commands, cmd)) {
      // TODO
    } else return false;
  }

  var r = repl.start("board > ");
  r.context.run = runCommand;
} */

/**
 * Return a chess.js compatible object representing this piece.
 * @param  {String} piece DGT named piece
 * @return {Object}       chess.js compatible representation
 */
function getObjectFromPiece(chess, piece) {
  if (piece === "EMPTY") {
    return null;
  }

  var color = piece[0] === "W" ? chess.WHITE : chess.BLACK;
  var pieceType = chess[piece.slice(1)];
  return { type: pieceType, color: color };
}

/**
 * Create an Index over the pieces.
 * @return {Object} Index of the form { Num1: Piece1, Num2: Piece2, ... }
 */
function createPiecesByIndex() {
  var pieces = {};
  for (var piece in protocol.pieces) {
    pieces[parseInt(protocol.pieces[piece], 16)] = piece;
  }
  return pieces;
}
