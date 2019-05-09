//
// Game maintains
// - A chess.js to validate and update moves
// - Two players
// - Game will switch back and forth to wait for move events from each
//   player in turn
// - A player can be an engine, which would wait for player to help move its
//   piece on the DGT board, validate it, and then let game know of its move
// - A player can also have a tutor engine, which helps analyze and offer
//   suggestions
// - If a real player wants to take back a move
// - If a real player made a move before making the engine's move on DGT, then
//   an flag is set.

const utils = require("./utils");
const chess = require("chess-js");
const protocol = require("./protocol.json");
const chalk = require("chalk");

const EventEmitter = require("events");

const TAKE_BACK_ACT = Symbol("take-back");
const RESET_ACT = Symbol("reset");

const emptyLogger = {
  log: (...args) => {
    console.log(...args);
  }
};

class ChessGame extends EventEmitter {
  constructor({ board, logger }) {
    super();
    this._board = board;
    this._chess = new chess.Chess();
    this._players = false;
    this._logger = logger || emptyLogger;
    this._pendingState = false;
    this._gameId = 0;
  }

  newGame(initPlayer, initFen, moves) {
    // const xt = "rnbqkbnr/ppp2ppp/8/3p4/4p3/3BPN2/PPPP1PPP/RNBQK2R w KQkq - 0 4";
    // const xt = "rnbqk2r/pppp1ppp/3b1n2/4p3/8/3BPN2/PPPP1PPP/RNBQK2R w KQkq - 0 4";
    // test en passant and black pawn promotion
    // const xt = "8/3k4/8/8/2p5/5K2/1P1P4/8 w - - 0 5";
    // test white pawn promotion
    // const xt = "8/1P1Pk3/2K5/8/8/8/8/8 w - - 0 5";
    // test black pawn promotion
    // const xt = "8/6P1/7K/3k4/8/8/1p6/8 b - - 0 5";
    // fen to get stockfish to do king side castling in next move
    // const xt = "r2qk2r/ppp2ppp/2np1n2/4p3/2P1P1b1/3P1N2/PP1NBPPP/R2QK2R w KQkq - 3 8";
    this._gameId++;
    this._initPlayer = initPlayer;
    this._initFen = initFen || utils.defaultFen;
    this._moves = moves || "";
    this._board.reset();
    this._chess.reset();
    this._chess.load(initFen);
    if (moves) {
      moves.split(" ").forEach(m => {
        if (m.startsWith("undo")) {
          let count = parseInt(m.split("_")[1]);
          while (count > 0) {
            this._chess.undo();
            count--;
          }
        } else {
          this._chess.move(m);
        }
      });
    }
    const startRaw = this._chess.toString();
    this._startFen = utils.rawToFen(startRaw);
    this._logger.log("new game");
    this.clearInterrupt();

    this.waitForBoardReady(startRaw, "wait-start", () => {
      this.readyForNewGame();
    });
  }

  getBoardRaw() {
    return this._board.toString();
  }

  getGameRaw() {
    return this._chess.toString();
  }

  waitForBoardReady(wantRaw, event, readyCb) {
    const wantAscii = utils.rawToAscii(wantRaw).join("\n");
    const waitReady = () => {
      const remove = () => {
        this._board.removeListener("changed", waitReady);
      };

      if (this.checkInterrupt()) {
        return remove();
      }

      const boardRaw = this._board.toString();
      if (boardRaw === wantRaw) {
        this._logger.log("board ready");
        this._pendingState = false;
        remove();
        this.emit("board-ready", { boardRaw });
        process.nextTick(() => readyCb());
        return true;
      } else {
        const boardAscii = utils.rawToAscii(boardRaw).join("\n");
        this.emit(event, { boardRaw, wantRaw });
        this._logger.log("waiting board ready for", event, boardRaw, wantRaw);
        this._logger.log(this.makeVisualMoveAscii(boardAscii, wantAscii));
        return false;
      }
    };

    if (!waitReady()) {
      this._pendingState = `wait-board-ready`;
      this._board.on("changed", waitReady);
    }
  }

  get turnColor() {
    return this._chess.turn() === this._chess.WHITE ? "white" : "black";
  }

  makeVisualMoveAscii(beforeAscii, afterAscii) {
    let visualMoveAscii = "";
    const before = Array.isArray(beforeAscii) ? beforeAscii : beforeAscii.split("\n");
    const after = Array.isArray(afterAscii) ? afterAscii : afterAscii.split("\n");
    for (let ix = 0; ix < before.length; ix++) {
      const br = before[ix];
      const ar = after[ix];
      for (let rx = 0; rx < br.length; rx++) {
        if (br[rx] !== ar[rx]) {
          if (!utils.isEmpty(ar[rx])) {
            visualMoveAscii += chalk.green(ar[rx]);
          } else {
            visualMoveAscii += chalk.magenta(br[rx]);
          }
        } else {
          visualMoveAscii += ar[rx];
        }
      }
      visualMoveAscii += "\n";
    }
    return visualMoveAscii;
  }

  async syncBoard(color, move, beforeBoard, beforeRaw) {
    this._logger.log("fen", this._chess.fen());
    let raw = "";
    const clr = color && color[0];
    const board = this._chess.board();
    board.forEach(row => {
      row.forEach(p => {
        if (p === null) {
          raw += ".";
        } else if (!clr || p.color === clr) {
          raw += p.color === this._chess.WHITE ? p.type.toUpperCase() : p.type.toLowerCase();
        } else {
          raw += ".";
        }
      });
    });

    const isSync = () =>
      this._board.stringByColor(color) === raw &&
      (!move.ep_square || utils.isEmpty(this._board.pieceByIndex(move.ep_index)));

    const commitBoard = () => {
      this._board.commit(color, raw, [move.ep_index]);
    };

    let visualMove = "";

    let count = 0;

    const showVisualMove = () => {
      this._logger.log(this._players[color].name, "moved");
      this._logger.log(
        "SAN:",
        chalk.yellow(move.san),
        "position",
        chalk.green(move.from),
        "->",
        chalk.green(move.to),
        "waiting for correct board update",
        count++
      );
      if (!visualMove) {
        visualMove = this.makeVisualMoveAscii(beforeBoard, this._chess.ascii());
      }
      this._logger.log(visualMove);
    };

    let notSyncNotifier;

    if (isSync()) {
      return commitBoard();
    }

    const extraDelay =
      move.flags &&
      (move.flags.indexOf(this._chess.FLAGS.KSIDE_CASTLE) >= 0 ||
        move.flags.indexOf(this._chess.FLAGS.QSIDE_CASTLE) >= 0)
        ? 1000
        : 0;

    this.emit("waiting-board-sync", { move, beforeRaw });
    let waiting;
    const promise = new Promise(resolve => {
      waiting = { resolve };
    });

    const checkSync = () => {
      const remove = () => {
        this._board.removeListener("changed", checkSync);
        clearTimeout(notSyncNotifier);
        notSyncNotifier = null;
      };

      if (this.checkInterrupt()) {
        this._logger.log("wait board sync interrupted");
        waiting.resolve("interrupted");
        return remove();
      }

      if (isSync()) {
        this._pendingState = false;
        remove();
        commitBoard();
        this.emit("board-synced");
        waiting.resolve();
      } else {
        if (notSyncNotifier) {
          clearTimeout(notSyncNotifier);
        }

        notSyncNotifier = setTimeout(() => {
          const board = this._board.toString();
          if (board !== beforeRaw) {
            this._logger.log("board change not sync - extraDelay", extraDelay);
            showVisualMove();
            this.emit("board-not-sync-change", { board, beforeRaw });
          }
        }, 1250 + extraDelay);
      }
    };

    this._pendingState = `wait-board-sync`;
    this._board.on("changed", checkSync);

    showVisualMove();
    return await promise;
  }

  getPlayer(color) {
    return this._players[color];
  }

  async move(m) {
    let chessMove;
    if (typeof m === "string") {
      chessMove = {
        from: m.substr(0, 2),
        to: m.substr(2, 2),
        promotion: m.substr(4, 1)
      };
    } else {
      chessMove = {
        from: protocol.fields[m.from.index],
        to: protocol.fields[m.to.index],
        promotion: m.promotion
      };
    }

    const legal = this._chess.move(chessMove);

    return { legal, move: chessMove };
  }

  fen() {
    return this._chess.fen();
  }

  async waitPlayerTurn(color, tryAgain) {
    const player = this._players[color];
    this._logger.log(`${color}'s turn`);
    const act = await player.yourTurn(tryAgain);

    const int = this.checkInterrupt();
    if (int) {
      return int;
    }

    let { legal, move } = await this.move(act.move);

    if (!legal) {
      this._logger.log(
        chalk.green(player.name),
        chalk.red("made an illegal move, try again please."),
        JSON.stringify(move)
      );
      //
      this.emit("illegal-move", { player, color, move });
      //
      return await this.waitPlayerTurn(color, true);
    } else {
      this._logger.log(this._chess.ascii());
    }

    if (legal.flags && legal.flags.indexOf(this._chess.FLAGS.EP_CAPTURE) >= 0) {
      // en passant
      // find ep_square
      let ep_index =
        protocol.fields.indexOf(legal.to) +
        (color === "white"
          ? // white's pawn is being captured by en passant
            8
          : // black's pawn is being captured by en passant
            -8);
      const ep_square = protocol.fields[ep_index];

      legal = Object.assign({ ep_index, ep_square }, legal);
    }

    return legal;
  }

  checkEndGame() {
    if (this._chess.in_draw()) {
      return { result: "draw" };
    } else if (this._chess.in_stalemate()) {
      return { result: stalemate };
    } else if (this._chess.in_threefold_repetition()) {
      return { result: "threefold repetition" };
    } else if (this._chess.in_checkmate()) {
      return { result: "checkmate", winner: this.turnColor === "white" ? "black" : "white" };
    } else {
      return false;
    }
  }

  waitForTakeBack() {
    this._logger.log("waiting for takeback");
    const event = "take-back-wait-board-ready";

    const moves = [this._chess.undo(), this._chess.undo()].filter(x => x);

    const continuePlay = () => {
      this._board.resetTo(this._chess.toString());
      Object.keys(this._players).forEach(c => {
        this._players[c].resume();
      });
      process.nextTick(() => this.play());
    };

    if (moves.length < 1) {
      continuePlay();
      return;
    }

    const afterBoard = this._chess.ascii();
    this.emit("take-back", { moves });

    const showTakebackPositions = () => {
      const visualMove = this.makeVisualMoveAscii(this._board.ascii().join("\n"), afterBoard);
      this._logger.log("waiting for takeback");
      this._logger.log(visualMove);
    };

    this.on(event, showTakebackPositions);
    showTakebackPositions();

    this.waitForBoardReady(this._chess.toString(), event, () => {
      this.removeListener(event, showTakebackPositions);
      continuePlay();
    });
  }

  async play() {
    const int = this.checkInterrupt();

    if (int === TAKE_BACK_ACT) {
      this.clearInterrupt();
      return this.waitForTakeBack();
    } else if (int === RESET_ACT) {
      this.clearInterrupt();
      return this._logger.log("reset");
    }

    const color = this.turnColor;
    const player = this._players[color];
    const beforeBoard = this._chess.ascii();
    const beforeRaw = this._chess.toString();
    const startTime = Date.now();

    const handleMove = async act => {
      const synced = await this.syncBoard(color, act, beforeBoard, beforeRaw);

      if (synced === "interrupted") {
        this._logger.log("handleMove sync board interrupted");
        this.emit("player-moved", { player, move: act, interrupted: true });
        process.nextTick(() => this.play());
        return;
      }

      this.emit("player-moved", { player, move: act });

      const result = this.checkEndGame();
      if (!result) {
        process.nextTick(() => this.play());
      } else {
        this.emit("game-over", result);
      }
    };

    this._pendingState = `wait-player-${color}`;
    const act = await this.waitPlayerTurn(color);
    this._pendingState = false;

    handleMove(act);
  }

  async readyForNewGame() {
    this._board.reset();
    const black = await this._initPlayer("black", this);
    const white = await this._initPlayer("white", this);
    this._players = { black, white };
    process.nextTick(() => {
      this.play();
    });
    this.emit("ready");
  }

  takeBack() {
    if (this._pendingState !== "wait-board-ready") {
      this.interrupt(TAKE_BACK_ACT, true);
    }
  }

  checkTakeback(color, move) {
    const last = this._chess.last_move(true);
    if (!last) return;
    this._logger.log("check take back move", move, "last", last);
    const from = protocol.fields[move.from.index];
    const to = protocol.fields[move.to.index];
    if (last.from === to && last.to === from && color[0] === last.color[0]) {
      // player tried to do a takeback of last move!
      this._logger.log("trying to takeback move", JSON.stringify(last));
      this.takeBack();
    }
  }

  interruptPlayers(type, pause) {
    Object.keys(this._players).forEach(c => {
      const p = this._players[c];
      if (p) {
        if (pause) p.pause();
        p.interrupt(type);
      }
    });
  }

  clearInterrupt() {
    this._logger.log("clear interrupt");
    this._interrupt = false;
    this._interruptType = undefined;
  }

  checkInterrupt() {
    if (this._interrupt === true) {
      return this._interruptType;
    }

    if (this._interrupt) {
      const interrupt = this._interrupt;
      this._interrupt = true;
      this._pendingState = false;
      process.nextTick(() => interrupt());
      return this._interruptType;
    }
  }

  async interrupt(type, pause) {
    type = type || RESET_ACT;
    this._interruptType = type;
    const interruptPromise = new Promise(resolve => {
      this._interrupt = resolve;
    });

    if (!this._pendingState) {
      process.nextTick(() => {
        this.checkInterrupt();
      });
    }

    // try to get out of any pending state
    this.interruptPlayers(type, pause);
    this._board.emitChanged();

    await interruptPromise;
  }

  async reset() {
    await this.interrupt(RESET_ACT);
  }
}

module.exports = ChessGame;
