"use strict";

/* eslint-disable prefer-template, no-magic-numbers, max-statements, complexity */

const util = require("util");
const EventEmitter = require("events").EventEmitter;
const SerialPort = require("serialport");
const protocol = require("./protocol.json");
const _ = require("lodash");
const utils = require("./utils");

/*
 * Return a chess.js compatible object representing this piece.
 * @param  {String} piece DGT named piece
 * @return {Object}       chess.js compatible representation
 */
// function getObjectFromPiece(chess, piece) {
//   if (piece === "EMPTY") {
//     return null;
//   }

//   const color = piece[0] === "W" ? chess.WHITE : chess.BLACK;
//   const pieceType = chess[piece.slice(1)];
//   return { type: pieceType, color: color };
// }

/**
 * Create an Index over the pieces.
 * @return {Object} Index of the form { Num1: Piece1, Num2: Piece2, ... }
 */
function createPiecesByIndex() {
  const pieces = {};
  for (const piece in protocol.pieces) {
    pieces[parseInt(protocol.pieces[piece], 16)] = piece;
  }
  return pieces;
}

//
// table for translating DGT field integer index (0-15) to piece names
//
const pieceByIndex = createPiecesByIndex();

//
// find index of field in linear array by its label, such as a8, b8, etc.
//
const fieldIndex = field => protocol.fields.indexOf(field);

//
// table for translating piece names to single alphabet letter
// rnbqkp for black pieces
// RNBQKP for white pieces
//
const letterByPiece = (() => {
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
  this.options = options = Object.assign({ stabilizeDelay: 600 }, options);
  this.changes = [];

  this._serialport = null;
  this._buffer = Buffer.alloc(0);
  this._queue = [];
  this._stabilizeDelay = options.stabilizeDelay;
  this._enableDetectMoves = true;

  this.serialNo = null;
  this.versionNo = null;

  // create new chess logic instance and clear its board
  this._data = new Array(64);
  this._prev = new Array(64);

  // connect to the serialport
  const dgt = new SerialPort(path, {
    baudRate: 9600
  });

  this._serialport = dgt;

  this._stablized = false;

  let stabilizeTimer;

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

    let currLength;
    while (this._queue[0] <= this._buffer.length) {
      currLength = this._queue.shift();
      this._queue.shift()(this._buffer.slice(0, currLength));
      this._buffer = this._buffer.slice(currLength);
    }
    return null;
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

Board.prototype.pieceByIndex = function(index) {
  return this._data[index];
};

/*
 * Read in serial number and version and fire the 'ready' event once finished.
 * Additionally initiates the other events by calling the _setMode() method.
 */
Board.prototype._prepareReadyEvent = function() {
  this.queue(protocol.commands.DGT_RETURN_SERIALNR, 8, data => {
    this.serialNo = data.toString("ascii");

    this.queue(protocol.commands.DGT_SEND_VERSION, 5, data2 => {
      this.versionNo = data2.readInt8(3) + "." + data2.readInt8(4);

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
  this.emit("changed");
};

Board.prototype.emitChanged = function() {
  this.emit("changed");
};

Board.prototype.stringByColor = function(color, data) {
  data = data || this._data;
  let isColor;
  if (color === "white") {
    isColor = utils.isWhite;
  } else if (color === "black") {
    isColor = utils.isBlack;
  } else {
    isColor = p => !utils.isEmpty(p) && true;
  }

  let rawStr = "";
  for (let ix = 0; ix < this._data.length; ix++) {
    if (isColor(data[ix])) {
      rawStr += data[ix];
    } else {
      rawStr += ".";
    }
  }

  return rawStr;
};

Board.prototype.commit = function(color, raw, removeIndex) {
  const isColor = color === "white" ? utils.isWhite : utils.isBlack;
  for (let ix = 0; ix < this._prev.length; ix++) {
    if (isColor(raw[ix]) && this._prev[ix] !== raw[ix]) {
      this._prev[ix] = raw[ix];
    } else if (raw[ix] === "." && isColor(this._prev[ix])) {
      this._prev[ix] = ".";
    }
  }

  removeIndex.forEach(x => {
    if (x !== undefined) this._prev[x] = ".";
  });

  // const prev = this._prev.join("");
};

Board.prototype.resetTo = function(raw) {
  for (let ix = 0; ix < this._prev.length; ix++) {
    this._prev[ix] = raw[ix];
  }
};

Board.prototype.getBoard = function(cb) {
  this.queue(protocol.commands.DGT_SEND_BRD, 67, data => {
    const fields = data.slice(3);

    let field;
    for (let i = 0; i < fields.length; i++) {
      field = fields.readInt8(i);
      const piece = pieceByIndex[field];
      if (piece !== undefined) {
        this._data[i] = letterByPiece[piece];
      }
    }

    cb();
  });
};

/*
 * Sets the Update Mode and creates the 'data' events.
 */
Board.prototype._setMode = function() {
  const dgt = this._serialport;

  // set mode
  this.options.mode = this.options.mode || Board.defaults.mode;
  if (!protocol.commands.hasOwnProperty(this.options.mode)) {
    this.options.mode = Board.defaults.mode;
  }
  dgt.write(Buffer.from(protocol.commands[this.options.mode], "hex"));

  this.listen(5, data => {
    const obj = {
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
  this._data = [];

  for (const field in msg.fields) {
    this._data[fieldIndex(field)] = letterByPiece[field];
  }

  return true;
};

Board.prototype.detectMoves = function() {
  ["black", "white"].forEach(color => {
    const move = this.findMove(color);
    if (!move) return;
    if (!move.invalid) {
      // emit black_move or white_move
      this.emit(`${color}_move`, move);
    } else {
      this.emit(`${color}_invalid_changes`, move);
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

  if (this._enableDetectMoves) {
    this.detectMoves();
  }
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

  // detect black promotion
  if (
    prevOnly.length === 1 &&
    currOnly.length === 1 &&
    prevOnly[0].piece === "p" &&
    currOnly[0].index > 55
  ) {
    if (
      currOnly[0].piece === "q" ||
      currOnly[0].piece === "n" ||
      currOnly[0].piece === "r" ||
      currOnly[0].piece === "b"
    ) {
      return {
        from: prevOnly[0],
        to: currOnly[0],
        promotion: currOnly[0].piece
      };
    } else {
      return false;
    }
  }

  // detect white promotion
  if (
    prevOnly.length === 1 &&
    currOnly.length === 1 &&
    prevOnly[0].piece === "P" &&
    currOnly[0].index < 8
  ) {
    if (
      currOnly[0].piece === "Q" ||
      currOnly[0].piece === "N" ||
      currOnly[0].piece === "R" ||
      currOnly[0].piece === "B"
    ) {
      return {
        from: prevOnly[0],
        to: currOnly[0],
        promotion: currOnly[0].piece.toLowerCase()
      };
    } else {
      return false;
    }
  }

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
      [
        { piece: "K", index: 60 },
        { piece: "R", index: 63 }
      ],
      [
        { piece: "K", index: 62 },
        { piece: "R", index: 61 }
      ]
    ],
    // white queen side from/to
    [
      [
        { piece: "K", index: 60 },
        { piece: "R", index: 56 }
      ],
      [
        { piece: "K", index: 58 },
        { piece: "R", index: 59 }
      ]
    ],
    // black king side from/to
    [
      [
        { piece: "K", index: 4 },
        { piece: "R", index: 7 }
      ],
      [
        { piece: "K", index: 6 },
        { piece: "R", index: 5 }
      ]
    ],
    // black queen side from/to
    [
      [
        { piece: "K", index: 4 },
        { piece: "R", index: 0 }
      ],
      [
        { piece: "K", index: 2 },
        { piece: "R", index: 3 }
      ]
    ]
  ];

  const castling = compoundCastleMoves.find(
    c => _.isEqual(c[0], prevOnly) && _.isEqual(c[1], currOnly)
  );

  if (castling) {
    // syncDelay allow game to wait longer for user to update
    // board to sync up
    return { from: prevOnly[0], to: currOnly[0], castling };
  }

  // TODO: alert about irregular changes

  if (prevOnly.length > 0 || currOnly.length > 0) {
    return { invalid: true, prevOnly, currOnly };
  }

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

  const r = repl.start("board > ");
  r.context.run = runCommand;
} */

module.exports = Board;
