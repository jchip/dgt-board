module.exports = Board;

var util = require("util");
var EventEmitter = require("events").EventEmitter;
var SerialPort = require("serialport");
var protocol = require("./protocol.json");

var piecesIndex = createPiecesIndex();

var fieldIndex = field => protocol.fields.indexOf(field);

var pieceLetters = (() => {
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

Board.prototype.getBoard = function(cb) {
  this.queue(protocol.commands.DGT_SEND_BRD, 67, data => {
    var fields = data.slice(3);

    var field;
    for (var i = 0; i < fields.length; i++) {
      field = fields.readInt8(i);
      if (field > 0 && piecesIndex.hasOwnProperty(field)) {
        this._data[i] = pieceLetters[piecesIndex[field]];
      } else {
        this._data[i] = ".";
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
      piece: piecesIndex[data.readInt8(4)]
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
    this._data[fieldIndex(field)] = pieceLetters[field];
  }
};

Board.prototype.processChanges = function() {
  const changes = this.changes;

  this.changes = [];

  changes.forEach(x => {
    const idx = fieldIndex(x.field);
    if (x.piece === "EMPTY") {
      this._data[idx] = ".";
    } else {
      this._data[idx] = pieceLetters[x.piece];
    }
  });

  this.emit("changed", this._data);
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
function createPiecesIndex() {
  var pieces = {};
  for (var piece in protocol.pieces) {
    pieces[parseInt(protocol.pieces[piece], 16)] = piece;
  }
  return pieces;
}
