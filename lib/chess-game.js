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

const emptyLogger = {
  log: () => {}
};

class ChessGame extends EventEmitter {
  constructor({ board, logger }) {
    super();
    this._board = board;
    this._chess = new chess.Chess();
    this._players = false;
    this._logger = logger || emptyLogger;
  }

  newGame(initPlayer, startFen) {
    // const xt = "rnbqkbnr/ppp2ppp/8/3p4/4p3/3BPN2/PPPP1PPP/RNBQK2R w KQkq - 0 4";
    // const xt = "rnbqk2r/pppp1ppp/3b1n2/4p3/8/3BPN2/PPPP1PPP/RNBQK2R w KQkq - 0 4";
    // test en passant and black pawn promotion
    // const xt = "8/3k4/8/8/2p5/5K2/1P1P4/8 w - - 0 5";
    // test white pawn promotion
    // const xt = "8/1P1Pk3/2K5/8/8/8/8/8 w - - 0 5";
    // test black pawn promotion
    // const xt = "8/6P1/7K/3k4/8/8/1p6/8 b - - 0 5";
    // fen to get stockfish to do king side castling in next move
    // const xt = "r2qk2r/ppp2ppp/2np1n2/4p3/2P1P1b1/3P1N2/PP1NBPPP/R2Q1RK1 b kq - 3 8";
    this._initPlayer = initPlayer;
    this._startFen = startFen || utils.defaultFen;
    const startRaw = utils.fenToRaw(this._startFen).join("");

    const waitStart = () => {
      const boardRaw = this._board.toString();
      this._logger.log("waiting", utils.rawToFen(boardRaw));
      if (boardRaw === startRaw) {
        this._logger.log("board ready");
        this._board.removeListener("changed", waitStart);
        this.readyForNewGame();
        return true;
      } else {
        this.emit("wait-start");
        this._logger.log("wait start", boardRaw, startRaw);
        return false;
      }
    };

    // wait for board to be in start position
    if (!waitStart()) {
      this._logger.log("waiting for board positions to be ready");
      this._board.on("changed", waitStart);
    }
  }

  get turnColor() {
    return this._chess.turn() === this._chess.WHITE ? "white" : "black";
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

    this._board.commit(color, raw, [move.ep_index]);

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
        const before = beforeBoard.split("\n");
        const after = this._chess.ascii().split("\n");
        for (let ix = 0; ix < before.length; ix++) {
          const br = before[ix];
          const ar = after[ix];
          for (let rx = 0; rx < br.length; rx++) {
            if (br[rx] !== ar[rx]) {
              if (!utils.isEmpty(ar[rx])) {
                visualMove += chalk.green(ar[rx]);
              } else {
                visualMove += chalk.magenta(br[rx]);
              }
            } else {
              visualMove += ar[rx];
            }
          }
          visualMove += "\n";
        }
      }
      this._logger.log(visualMove);
    };

    let notSyncNotifier;

    if (!isSync()) {
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
        if (isSync()) {
          this._board.removeListener("changed", checkSync);
          clearTimeout(notSyncNotifier);
          notSyncNotifier = null;
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

      this._board.on("changed", checkSync);

      showVisualMove();
      await promise;
    }
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
    let { legal, move } = await this.move(act.move);
    if (!legal) {
      this._logger.log(
        chalk.green(player.name),
        chalk.red("made an illegal move, try again please.")
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
      return "Game is a Draw";
    } else if (this._chess.in_stalemate()) {
      return "Game is stalemate";
    } else if (this._chess.in_threefold_repetition()) {
      return "Game is in threefold repetition";
    } else if (this._chess.in_checkmate()) {
      return "Game over, checkmate";
    } else {
      return false;
    }
  }

  async play() {
    const color = this.turnColor;
    const beforeBoard = this._chess.ascii();
    const beforeRaw = this._chess.toString();
    const act = await this.waitPlayerTurn(color);

    await this.syncBoard(color, act, beforeBoard, beforeRaw);

    this.emit("player-moved", { player: this._players[color], move: act });
    const result = this.checkEndGame();
    if (!result) {
      process.nextTick(() => this.play());
    } else {
      this.emit("game-over", { result });
    }
  }

  async readyForNewGame() {
    this._board.reset();
    this._chess.load(this._startFen);
    const black = await this._initPlayer("black", this);
    const white = await this._initPlayer("white", this);
    this._players = { black, white };
    process.nextTick(() => this.play());
    this.emit("ready");
  }
}

module.exports = ChessGame;