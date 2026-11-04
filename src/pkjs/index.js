// ── NFL Central - PebbleKit JS ─────────────────────────────────────────────
// Fetches data from ESPN's free web API and sends each screen to the watch
// as text rows: rows separated by "\n", fields separated by "|".
// See the row formats at the top of src/c/list_window.c.

// Must match the enum in src/c/app.h exactly
var REQ_GAMES = 1, REQ_GAME = 2, REQ_STANDINGS = 3, REQ_TEAM = 4, REQ_LEADERS = 5,
    REQ_PLAYOFFS = 6, REQ_SETTINGS = 7, REQ_SET_FAV = 8, REQ_WEEK = 9;

var SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/";
var STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/football/nfl/standings?level=3";
var STATS_URL = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/statistics/byathlete";
var MAX_DATA = 3800;   // watch buffer is 4096 bytes

// Same order as the watch: AFC East, North, South, West, then the NFC
var DIVISIONS = ["AFC East", "AFC North", "AFC South", "AFC West",
                 "NFC East", "NFC North", "NFC South", "NFC West"];
var TEAMS = {
  BUF: "Bills", MIA: "Dolphins", NE: "Patriots", NYJ: "Jets",
  BAL: "Ravens", CIN: "Bengals", CLE: "Browns", PIT: "Steelers",
  HOU: "Texans", IND: "Colts", JAX: "Jaguars", TEN: "Titans",
  DEN: "Broncos", KC: "Chiefs", LV: "Raiders", LAC: "Chargers",
  DAL: "Cowboys", NYG: "Giants", PHI: "Eagles", WSH: "Commanders",
  CHI: "Bears", DET: "Lions", GB: "Packers", MIN: "Vikings",
  ATL: "Falcons", CAR: "Panthers", NO: "Saints", TB: "Buccaneers",
  ARI: "Cardinals", LAR: "Rams", SF: "49ers", SEA: "Seahawks"
};
var ROUNDS = { 1: "Wild Card", 2: "Divisional", 3: "Conf. Championships", 5: "Super Bowl" };

// ── Settings ──────────────────────────────────────────────────────────────
var DEFAULT_SETTINGS = { fav: "KC", follow: [], vibrate: true, redZone: true, closeGame: true,
                         autoOpen: true, wake: true, timeline: true };

function loadSettings() {
  var s = {};
  try { s = JSON.parse(localStorage.getItem("settings")) || {}; } catch (e) {}
  for (var k in DEFAULT_SETTINGS) {
    if (s[k] === undefined) s[k] = DEFAULT_SETTINGS[k];
  }
  if (!TEAMS[s.fav]) s.fav = DEFAULT_SETTINGS.fav;
  return s;
}

function saveSettings(s) {
  localStorage.setItem("settings", JSON.stringify(s));
}

var gSettings = loadSettings();

// ── Test data ─────────────────────────────────────────────────────────────
// A local, uncommitted src/pkjs/sim.json maps URL fragments to canned ESPN
// responses so screens can be checked without a live game. It is in
// .gitignore and never ships.
var SIM = null;
try { SIM = require("./sim.json"); } catch (e) { SIM = null; }

// ── Sending to the watch (one message at a time) ──────────────────────────
var gQueue = [];
var gSending = false;

function send(msg) {
  gQueue.push(msg);
  pump();
}

function pump() {
  if (gSending || gQueue.length === 0) return;
  gSending = true;
  var msg = gQueue.shift();
  Pebble.sendAppMessage(msg, function () {
    gSending = false;
    pump();
  }, function (e) {
    console.log("[NFL] send failed: " + JSON.stringify(e));
    gSending = false;
    pump();
  });
}

function clean(s) {
  return String(s === undefined || s === null ? "" : s).replace(/[|\n]/g, " ");
}

function row() {
  var parts = [];
  for (var i = 0; i < arguments.length; i++) parts.push(clean(arguments[i]));
  return parts.join("|");
}

function sendRows(type, arg, rows) {
  var data = rows.join("\n");
  // Drop rows from the end until it fits (counting UTF-8 bytes)
  while (unescape(encodeURIComponent(data)).length > MAX_DATA && rows.length > 1) {
    rows.pop();
    data = rows.join("\n");
  }
  send({ TYPE: type, ARG: arg, DATA: data });
}

function sendError(type, arg, text) {
  send({ TYPE: type, ARG: arg, ERROR: text });
}

// ── HTTP with a short cache ───────────────────────────────────────────────
var gCache = {};

function getJSON(url, maxAgeSecs, cb) {
  if (SIM) {
    for (var key in SIM) {
      // "$text" matches the end of the URL, anything else a fragment of it
      var hitSim = key.charAt(0) === "$" ? url.slice(-(key.length - 1)) === key.slice(1)
                                         : url.indexOf(key) >= 0;
      if (hitSim) { cb(null, SIM[key]); return; }
    }
  }
  var hit = gCache[url];
  if (hit && Date.now() - hit.time < maxAgeSecs * 1000) {
    cb(null, hit.data);
    return;
  }
  var xhr = new XMLHttpRequest();
  xhr.open("GET", url, true);
  xhr.setRequestHeader("Accept", "application/json");
  xhr.timeout = 15000;
  xhr.onload = function () {
    if (xhr.status !== 200) {
      cb("ESPN data error (" + xhr.status + ")");
      return;
    }
    try {
      var data = JSON.parse(xhr.responseText);
      gCache[url] = { time: Date.now(), data: data };
      cb(null, data);
    } catch (e) {
      cb("Couldn't read ESPN data");
    }
  };
  xhr.onerror = xhr.ontimeout = function () { cb("No connection"); };
  xhr.send();
}

function scoreboardUrl(seasonType, week) {
  var q = seasonType ? "?seasontype=" + seasonType + "&week=" + week : "";
  return SITE + "scoreboard" + q;
}

// ── Formatting helpers ────────────────────────────────────────────────────
var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

// ESPN dates look like "2026-10-30T00:15Z" (no seconds), which not every
// JavaScript engine parses, so build the time by hand.
function parseDate(iso) {
  var m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(iso || "");
  if (!m) return new Date(NaN);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
}

function formatTime(iso) {
  var d = parseDate(iso);
  if (isNaN(d.getTime())) return "";
  var h = d.getHours(), m = d.getMinutes();
  var ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + pad2(m) + " " + ampm;
}

function dayKey(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

function formatDay(iso) {
  var d = parseDate(iso);
  return isNaN(d.getTime()) ? "" : DAYS[d.getDay()] + " " + MONTHS[d.getMonth()] + " " + d.getDate();
}

function formatDayTime(iso) {
  var d = parseDate(iso);
  return isNaN(d.getTime()) ? "" : DAYS[d.getDay()] + " " + formatTime(iso);
}

function ordinal(n) {
  n = +n || 0;
  var s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function signed(v) {
  v = String(v === undefined ? "" : v);
  return v;
}

// ── ESPN game helpers ─────────────────────────────────────────────────────
function compOf(ev) { return (ev.competitions && ev.competitions[0]) || ev; }

function side(comp, homeAway) {
  var cs = comp.competitors || [];
  for (var i = 0; i < cs.length; i++) if (cs[i].homeAway === homeAway) return cs[i];
  return cs[homeAway === "home" ? 1 : 0] || {};
}

function abbrOf(c) { return ((c && c.team) || {}).abbreviation || "TBD"; }

function scoreOf(c) {
  var s = c && c.score;
  if (s && typeof s === "object") s = s.displayValue;
  return parseInt(s, 10) || 0;
}

function recordOf(c) {
  var recs = (c && c.records) || (c && c.record) || [];
  return recs.length ? (recs[0].summary || recs[0].displayValue || "") : "";
}

function stateOf(comp) {
  var st = ((comp.status || {}).type || {}).state;
  return st === "in" ? "L" : st === "post" ? "F" : "P";
}

function statusText(comp, date) {
  var s = comp.status || {}, t = s.type || {}, st = stateOf(comp);
  if (st === "P") {
    if (t.name === "STATUS_POSTPONED") return "Postponed";
    if (t.name === "STATUS_CANCELED") return "Canceled";
    return formatDayTime(date || comp.date);
  }
  if (st === "F") return (s.period > 4 || /OT/.test(t.shortDetail || "")) ? "Final/OT" : "Final";
  if (t.name === "STATUS_HALFTIME") return "Half";
  if (t.name === "STATUS_END_PERIOD") return "End Q" + s.period;
  return (s.period > 4 ? "OT" : "Q" + s.period) + " " + (s.displayClock || "");
}

// "TEAM 35" or "50": yards from the named team's own goal line
function parsePossession(text) {
  var m = /^([A-Z]+)\s+(\d+)$/.exec((text || "").trim());
  if (m) return { team: m[1], yard: parseInt(m[2], 10) };
  var m2 = /^(\d+)$/.exec((text || "").trim());
  return m2 ? { team: null, yard: parseInt(m2[1], 10) } : null;
}

// 0 = away goal line, 100 = home goal line
function fieldPos(situation, away, home) {
  var p = parsePossession(situation.possessionText);
  if (!p) return 50;
  if (p.team === away) return p.yard;
  if (p.team === home) return 100 - p.yard;
  return 50;
}

// Which team has the ball: 0 away, 1 home, 2 nobody
function possessionOf(comp, situation) {
  var id = situation && situation.possession;
  if (id !== undefined && id !== null) {
    if (String(((side(comp, "away").team) || {}).id) === String(id)) return 0;
    if (String(((side(comp, "home").team) || {}).id) === String(id)) return 1;
  }
  var p = parsePossession(situation && situation.possessionText);
  if (p && p.team === abbrOf(side(comp, "away"))) return 0;
  if (p && p.team === abbrOf(side(comp, "home"))) return 1;
  return 2;
}

function redZoneTeam(comp) {
  var sit = comp.situation;
  if (!sit || stateOf(comp) !== "L" || !sit.isRedZone) return "";
  var poss = possessionOf(comp, sit);
  return poss === 0 ? abbrOf(side(comp, "away")) : poss === 1 ? abbrOf(side(comp, "home")) : "";
}

function matchupRow(ev) {
  var comp = compOf(ev);
  var a = side(comp, "away"), h = side(comp, "home");
  return row("M", abbrOf(a), scoreOf(a), abbrOf(h), scoreOf(h),
             statusText(comp, ev.date), ev.id, stateOf(comp),
             (comp.status || {}).period || 0, redZoneTeam(comp));
}

function findEvent(events, abbr) {
  for (var i = 0; i < events.length; i++) {
    var comp = compOf(events[i]);
    if (abbrOf(side(comp, "away")) === abbr || abbrOf(side(comp, "home")) === abbr) return events[i];
  }
  return null;
}

function byeList(data) {
  return ((data && data.week && data.week.teamsOnBye) || []).map(function (t) { return t.abbreviation; });
}

// ── Games lists ───────────────────────────────────────────────────────────
// One section per day. `label` ("Week 8") leads the first day's header.
function gameSections(data, label) {
  // Future playoff rounds list placeholder teams until the matchups are set
  var events = ((data && data.events) || []).filter(function (ev) {
    var comp = compOf(ev);
    return TEAMS[abbrOf(side(comp, "away"))] && TEAMS[abbrOf(side(comp, "home"))];
  });
  var rows = [], lastDay = null, any = false;
  events.slice().sort(function (x, y) { return parseDate(x.date) - parseDate(y.date); })
    .forEach(function (ev) {
      var key = dayKey(parseDate(ev.date));
      if (key !== lastDay) {
        rows.push("#|" + (any ? "" : label + " - ") + formatDay(ev.date));
        lastDay = key;
        any = true;
      }
      rows.push(matchupRow(ev));
    });
  var byes = byeList(data);
  if (byes.length) {
    rows.push("#|On bye");
    rows.push(row("R", "Bye week", "", byes.join(", "), "", ""));
  }
  if (!rows.length) rows.push("#|No games scheduled");
  return rows;
}

function sendGames(arg) {
  getJSON(scoreboardUrl(), 20, function (err, data) {
    if (err) return sendError(REQ_GAMES, arg, err);
    var week = (data.week || {}).number;
    var label = ((data.season || {}).type === 3) ? (ROUNDS[week] || "Playoffs") : "Week " + week;
    var rows = ["!|30"];
    var mine = findEvent(data.events || [], gSettings.fav);
    if (!mine) {
      rows.push(byeList(data).indexOf(gSettings.fav) >= 0 ? "N|Bye week" : "N|No game this week");
    }
    sendRows(REQ_GAMES, arg, rows.concat(gameSections(data, label)));
  });
}

function sendWeek(arg) {
  var parts = String(arg).split(":");
  var type = +parts[0] || 2, week = +parts[1] || 1;
  getJSON(scoreboardUrl(type, week), 30, function (err, data) {
    if (err) return sendError(REQ_WEEK, arg, err);
    var label = type === 3 ? (ROUNDS[week] || "Playoffs") : "Week " + week;
    var rows = gameSections(data, label);
    var live = (data.events || []).some(function (ev) { return stateOf(compOf(ev)) === "L"; });
    if (rows.length <= 1 || rows[0] === "#|No games scheduled") rows = ["#|" + label, row("R", "No games yet", "", "Check back closer to the date", "", "")];
    sendRows(REQ_WEEK, arg, ["!|" + (live ? 30 : 0)].concat(rows));
  });
}

// ── Standings (shared by several screens) ─────────────────────────────────
function statMap(entry) {
  var m = {};
  (entry.stats || []).forEach(function (s) { m[s.name] = s.displayValue !== undefined ? s.displayValue : s.value; });
  return m;
}

function getStandings(cb) {
  getJSON(STANDINGS_URL, 300, function (err, data) {
    if (err) return cb(err);
    var list = [];
    (data.children || []).forEach(function (conf, ci) {
      (conf.children || []).forEach(function (div, di) {
        // ESPN lists each division in rank order
        (div.standings.entries || []).forEach(function (e, rank) {
          var s = statMap(e);
          var abbr = (e.team || {}).abbreviation;
          list.push({
            abbr: abbr, name: TEAMS[abbr] || (e.team || {}).shortDisplayName || abbr,
            conf: ci === 0 ? "AFC" : "NFC", div: ci * 4 + di, divRank: rank + 1,
            seed: +s.playoffSeed || 99,
            w: +s.wins || 0, l: +s.losses || 0, t: +s.ties || 0,
            pct: parseFloat(s.winPercent) || 0,
            pf: s.pointsFor, pa: s.pointsAgainst, diff: s.pointDifferential || s.differential || "",
            streak: s.streak || "", home: s.Home || "", road: s.Road || "",
            divRec: s["vs. Div."] || "", confRec: s["vs. Conf."] || ""
          });
        });
      });
    });
    cb(null, list);
  });
}

function record(t) {
  return t ? t.w + "-" + t.l + (t.t ? "-" + t.t : "") : "";
}

function findTeam(list, abbr) {
  for (var i = 0; i < list.length; i++) if (list[i].abbr === abbr) return list[i];
  return null;
}

function standingsRow(t, rankText) {
  return row("R", rankText + " " + t.name, record(t),
             "PF " + t.pf + "  PA " + t.pa + (t.streak ? "  " + t.streak : ""), t.abbr, "");
}

function sendStandings(arg) {
  getStandings(function (err, list) {
    if (err) return sendError(REQ_STANDINGS, arg, err);
    var rows = [];
    if (arg === "DIV") {
      for (var d = 0; d < 8; d++) {
        rows.push("#|" + DIVISIONS[d]);
        list.filter(function (t) { return t.div === d; }).sort(function (a, b) { return a.divRank - b.divRank; })
          .forEach(function (t) { rows.push(standingsRow(t, t.divRank + ".")); });
      }
    } else if (arg === "AFC" || arg === "NFC") {
      var conf = list.filter(function (t) { return t.conf === arg; })
        .sort(function (a, b) { return a.seed - b.seed; });
      var groups = [["Division leaders", 1, 4], ["Wild card", 5, 7], ["In the hunt", 8, 99]];
      groups.forEach(function (g) {
        var part = conf.filter(function (t) { return t.seed >= g[1] && t.seed <= g[2]; });
        if (!part.length) return;
        rows.push("#|" + arg + " - " + g[0]);
        part.forEach(function (t) { rows.push(standingsRow(t, t.seed + ".")); });
      });
    } else {
      rows.push("#|League");
      list.slice().sort(function (a, b) { return b.pct - a.pct || parseInt(b.diff, 10) - parseInt(a.diff, 10); })
        .forEach(function (t, i) { rows.push(standingsRow(t, (i + 1) + ".")); });
    }
    sendRows(REQ_STANDINGS, arg, rows);
  });
}

// ── One game ──────────────────────────────────────────────────────────────
function cleanPlay(text) {
  return String(text || "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").replace(/\s+\./g, ".").trim();
}

function statPair(box, name, away, home, fmt) {
  var out = { away: "-", home: "-" };
  (box.teams || []).forEach(function (t) {
    var abbr = (t.team || {}).abbreviation;
    (t.statistics || []).forEach(function (s) {
      if (s.name !== name) return;
      var v = fmt ? fmt(s.displayValue) : s.displayValue;
      if (abbr === away) out.away = v;
      else if (abbr === home) out.home = v;
    });
  });
  return out;
}

function sendGame(arg) {
  getJSON(SITE + "summary?event=" + arg, 8, function (err, sum) {
    if (err) return sendError(REQ_GAME, arg, err);
    getJSON(scoreboardUrl(), 8, function (err2, board) {
      // The scoreboard has the live situation (down, distance, ball spot)
      var live = board && findById(board.events || [], arg);
      var header = ((sum.header || {}).competitions || [])[0] || {};
      var comp = live ? compOf(live) : header;
      var date = live ? live.date : header.date;
      var a = side(comp, "away"), h = side(comp, "home");
      var away = abbrOf(a), home = abbrOf(h);
      var st = stateOf(comp);
      var sit = comp.situation;

      var sub = "";
      if (st === "P") sub = networkOf(comp);
      else if (st === "L" && sit) {
        sub = (sit.shortDownDistanceText || sit.downDistanceText || "") +
              (sit.possessionText ? " at " + sit.possessionText : "");
      }
      var rows = ["!|" + (st === "L" ? 15 : st === "P" ? 120 : 0)];
      rows.push(row("G", away, scoreOf(a), home, scoreOf(h), statusText(comp, date), sub, st));
      if (st === "L" && sit && sit.possessionText) {
        rows.push(row("F", away, home, fieldPos(sit, away, home), possessionOf(comp, sit),
                      sit.isRedZone ? 1 : 0));
      }

      if (st === "L") {
        var poss = possessionOf(comp, sit);
        var possAbbr = poss === 0 ? away : poss === 1 ? home : "";
        if (sit && sit.lastPlay && sit.lastPlay.text) {
          rows.push("#|Last play");
          rows.push(row("S", possAbbr, "", "", cleanPlay(sit.lastPlay.text)));
        }
        var cur = (sum.drives || {}).current;
        if (cur && cur.description) {
          rows.push("#|Current drive");
          rows.push(row("R", "Drive", ((cur.team || {}).abbreviation || ""), cur.description,
                        (cur.team || {}).abbreviation || "", ""));
        }
      }

      // Scoring plays, grouped by quarter
      var plays = sum.scoringPlays || [], lastQ = null;
      plays.forEach(function (p) {
        var q = (p.period || {}).number || 0;
        if (q !== lastQ) {
          rows.push("#|" + (q > 4 ? "Overtime" : ordinal(q) + " quarter"));
          lastQ = q;
        }
        var tag = ((p.type || {}).abbreviation || "") + " " + ((p.clock || {}).displayValue || "");
        rows.push(row("S", (p.team || {}).abbreviation, tag.trim(), p.awayScore + "-" + p.homeScore,
                      p.text));
      });

      if (st !== "P") {
        var box = sum.boxscore || {};
        rows.push("#|Stats (" + away + " - " + home + ")");
        [["Total yards", "totalYards"], ["Passing yards", "netPassingYards"],
         ["Rushing yards", "rushingYards"], ["First downs", "firstDowns"],
         ["3rd down", "thirdDownEff"], ["Turnovers", "turnovers"],
         ["Possession", "possessionTime"], ["Penalties", "totalPenaltiesYards"]
        ].forEach(function (s) {
          var pr = statPair(box, s[1], away, home);
          rows.push(row("R", s[0], pr.away + " - " + pr.home, "", "", ""));
        });
      }

      rows.push("#|Game");
      [[a, away], [h, home]].forEach(function (x) {
        rows.push(row("R", TEAMS[x[1]] || x[1], recordOf(x[0]), "", x[1], ""));
      });
      var info = sum.gameInfo || {};
      if (info.venue && info.venue.fullName) rows.push(row("R", "Venue", "", info.venue.fullName, "", ""));
      var net = networkOf(comp);
      if (net && st !== "P") rows.push(row("R", "TV", net, "", "", ""));
      if (info.weather && info.weather.displayValue) {
        rows.push(row("R", "Weather", info.weather.displayValue,
                      info.weather.temperature ? info.weather.temperature + "°F" : "", "", ""));
      }
      sendRows(REQ_GAME, arg, rows);
    });
  });
}

function findById(events, id) {
  for (var i = 0; i < events.length; i++) if (String(events[i].id) === String(id)) return events[i];
  return null;
}

function networkOf(comp) {
  var b = comp.broadcasts || comp.geoBroadcasts || [];
  if (!b.length) return "";
  var names = (b[0].names) || ((b[0].media) ? [b[0].media.shortName] : []);
  return names && names.length ? names.join(", ") : "";
}

// ── One team ──────────────────────────────────────────────────────────────
function sendTeam(abbr) {
  if (!TEAMS[abbr]) return sendError(REQ_TEAM, abbr, "Unknown team");
  getStandings(function (err, list) {
    var s = list ? findTeam(list, abbr) : null;
    getJSON(SITE + "teams/" + abbr.toLowerCase() + "/schedule", 120, function (err2, sched) {
      if (err && err2) return sendError(REQ_TEAM, abbr, err2);
      getJSON(scoreboardUrl(), 20, function (err3, board) {
        var rows = ["!|60"];
        rows.push(row("T", abbr, TEAMS[abbr],
                      s ? record(s) + (s.diff ? ", " + s.diff + " pts" : "") : "",
                      s ? ordinal(s.divRank) + " " + DIVISIONS[s.div] + (s.streak ? ", " + s.streak : "") : ""));

        var current = board ? findEvent(board.events || [], abbr) : null;
        var curId = current ? String(current.id) : "";
        if (current) {
          rows.push("#|" + (stateOf(compOf(current)) === "L" ? "Live now" : "This week"));
          rows.push(matchupRow(current));
        } else if (board && byeList(board).indexOf(abbr) >= 0) {
          rows.push("#|This week");
          rows.push(row("R", "Bye week", "", "No game this week", "", ""));
        }

        if (s) {
          rows.push("#|Season");
          rows.push(row("R", "Division", ordinal(s.divRank), DIVISIONS[s.div], "", ""));
          rows.push(row("R", "Playoff seed", s.seed < 99 ? "#" + s.seed : "-", s.conf, "", ""));
          rows.push(row("R", "Points", s.pf + " - " + s.pa, "For - against (" + s.diff + ")", "", ""));
          rows.push(row("R", "Home", s.home, "", "", ""));
          rows.push(row("R", "Road", s.road, "", "", ""));
          rows.push(row("R", "Division record", s.divRec, "", "", ""));
          if (s.streak) rows.push(row("R", "Streak", s.streak, "", "", ""));
        }

        var events = (sched && sched.events) || [];
        var upcoming = [], recent = [];
        events.forEach(function (ev) {
          if (String(ev.id) === curId) return;
          var comp = compOf(ev), st = stateOf(comp);
          if (st === "P") upcoming.push(ev);
          else if (st === "F") recent.push(ev);
        });
        if (sched && sched.byeWeek) {
          rows.push(row("R", "Bye week", "Week " + sched.byeWeek, "", "", ""));
        }
        if (upcoming.length) {
          rows.push("#|Next games");
          upcoming.slice(0, 5).forEach(function (ev) {
            var comp = compOf(ev);
            var home = abbrOf(side(comp, "home")) === abbr;
            var opp = abbrOf(side(comp, home ? "away" : "home"));
            rows.push(row("R", (home ? "vs " : "@ ") + opp, formatDayTime(ev.date),
                          ((ev.week || {}).text || "") + " - " + formatDay(ev.date), opp, ev.id));
          });
        }
        if (recent.length) {
          rows.push("#|Recent");
          recent.slice(-5).reverse().forEach(function (ev) {
            var comp = compOf(ev);
            var home = abbrOf(side(comp, "home")) === abbr;
            var me = side(comp, home ? "home" : "away"), them = side(comp, home ? "away" : "home");
            var ms = scoreOf(me), ts = scoreOf(them);
            var res = ms > ts ? "W" : ms < ts ? "L" : "T";
            rows.push(row("R", res + " " + ms + "-" + ts, (home ? "vs " : "@ ") + abbrOf(them),
                          ((ev.week || {}).text || "") + " - " + formatDay(ev.date), abbrOf(them), ev.id));
          });
        }
        if (gSettings.fav !== abbr) {
          rows.push("#|My Team");
          rows.push(row("L", "Make " + TEAMS[abbr] + " my team", "Or hold Select on any team",
                        REQ_SET_FAV, abbr, abbr));
        }
        sendRows(REQ_TEAM, abbr, rows);
      });
    });
  });
}

// ── League leaders ────────────────────────────────────────────────────────
// sort = ESPN sort key, cat/stat = where to find the number in each player's totals
var LEADERS = {
  passYds:  { title: "Passing Yards",   sort: "passing.passingYards",       cat: "passing",   stat: "passingYards" },
  passTD:   { title: "Passing TDs",     sort: "passing.passingTouchdowns",  cat: "passing",   stat: "passingTouchdowns" },
  rushYds:  { title: "Rushing Yards",   sort: "rushing.rushingYards",       cat: "rushing",   stat: "rushingYards" },
  rushTD:   { title: "Rushing TDs",     sort: "rushing.rushingTouchdowns",  cat: "rushing",   stat: "rushingTouchdowns" },
  recYds:   { title: "Receiving Yards", sort: "receiving.receivingYards",   cat: "receiving", stat: "receivingYards" },
  rec:      { title: "Receptions",      sort: "receiving.receptions",       cat: "receiving", stat: "receptions" },
  recTD:    { title: "Receiving TDs",   sort: "receiving.receivingTouchdowns", cat: "receiving", stat: "receivingTouchdowns" },
  sacks:    { title: "Sacks",           sort: "defensive.sacks",            cat: "defensive", stat: "sacks" },
  points:   { title: "Points",          sort: "scoring.totalPoints",        cat: "scoring",   stat: "totalPoints" }
};

function seasonYear() {
  var d = new Date();
  return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;   // the season starts in September
}

function sendLeaders(arg) {
  var def = LEADERS[arg];
  if (!def) return sendError(REQ_LEADERS, arg, "Unknown stat");
  var url = STATS_URL + "?limit=20&season=" + seasonYear() + "&seasontype=2&sort=" +
            encodeURIComponent(def.sort + ":desc");
  getJSON(url, 600, function (err, data) {
    if (err) return sendError(REQ_LEADERS, arg, err);
    var rows = ["#|" + def.title];
    (data.athletes || []).forEach(function (p, i) {
      var cat = null;
      (p.categories || []).forEach(function (c) { if (c.name === def.cat) cat = c; });
      var cats = (data.categories || []).filter(function (c) { return c.name === def.cat; })[0];
      var idx = cats && cats.names ? cats.names.indexOf(def.stat) : -1;
      var value = cat && idx >= 0 ? cat.totals[idx] : "";
      var ath = p.athlete || {};
      var first = (ath.firstName || "").charAt(0);
      var who = first ? first + ". " + (ath.lastName || "") : (ath.displayName || "");
      rows.push(row("R", (i + 1) + ". " + who, value,
                    (ath.teamShortName || "") + ((ath.position || {}).abbreviation ? " - " + ath.position.abbreviation : ""),
                    ath.teamShortName, ""));
    });
    if (rows.length === 1) rows.push(row("R", "No stats yet", "", "", "", ""));
    sendRows(REQ_LEADERS, arg, rows);
  });
}

// ── Playoffs ──────────────────────────────────────────────────────────────
function sendPlayoffs(arg) {
  var weeks = [1, 2, 3, 5], results = {}, pending = weeks.length;
  weeks.forEach(function (w) {
    getJSON(scoreboardUrl(3, w), 60, function (err, data) {
      results[w] = (!err && data && data.events && data.events.some(function (ev) {
        var comp = compOf(ev);
        return TEAMS[abbrOf(side(comp, "away"))] && TEAMS[abbrOf(side(comp, "home"))];
      })) ? data : null;
      if (--pending > 0) return;
      var rows = ["!|60"];
      weeks.forEach(function (wk) {
        if (!results[wk]) return;
        rows.push("#|" + ROUNDS[wk]);
        results[wk].events.forEach(function (ev) {
          var comp = compOf(ev);
          if (TEAMS[abbrOf(side(comp, "away"))] && TEAMS[abbrOf(side(comp, "home"))]) rows.push(matchupRow(ev));
        });
      });
      if (rows.length === 1) {
        rows.push("#|Playoffs");
        rows.push(row("R", "No playoff games yet", "", "Check back in January", "", ""));
      }
      sendRows(REQ_PLAYOFFS, arg, rows);
    });
  });
}

// ── Settings to the watch ─────────────────────────────────────────────────
// Includes the kickoff time of your team's next game, so the watch can wake
// up and open the app when the game starts.
function nextGame(abbr, cb) {
  getJSON(SITE + "teams/" + abbr.toLowerCase() + "/schedule", 600, function (err, sched) {
    var now = Date.now(), out = [];
    ((!err && sched && sched.events) || []).forEach(function (ev) {
      var t = parseDate(ev.date).getTime();
      if (stateOf(compOf(ev)) === "P" && t > now + 60000) out.push(ev);
    });
    cb(err, out, sched);
  });
}

function sendSettings() {
  var msg = {
    FAV_TEAM: gSettings.fav,
    FOLLOW: gSettings.follow.join(","),
    VIBRATE: gSettings.vibrate ? 1 : 0,
    AUTO_OPEN: gSettings.autoOpen ? 1 : 0,
    RED_ZONE: gSettings.redZone ? 1 : 0,
    CLOSE_GAME: gSettings.closeGame ? 1 : 0,
    WAKE_TIME: 0
  };
  if (!gSettings.wake) {
    send(msg);
    return;
  }
  nextGame(gSettings.fav, function (err, upcoming) {
    if (upcoming.length) msg.WAKE_TIME = Math.floor(parseDate(upcoming[0].date).getTime() / 1000);
    send(msg);
  });
}

// ── Timeline pins ─────────────────────────────────────────────────────────
// Pins your team's next few games to the Pebble timeline. The phone makes the
// pins itself (no server needed) and refreshes them whenever the app opens.
var PIN_COUNT = 5;

function loadPinIds() {
  try { return JSON.parse(localStorage.getItem("pinIds")) || []; } catch (e) { return []; }
}

function removePins(keep) {
  loadPinIds().forEach(function (id) {
    if (!keep || !keep[id]) Pebble.deleteTimelinePin(id);
  });
}

function buildPin(ev, standings) {
  var comp = compOf(ev);
  var a = abbrOf(side(comp, "away")), h = abbrOf(side(comp, "home"));
  var as = findTeam(standings, a), hs = findTeam(standings, h);
  var venue = (comp.venue || {}).fullName;
  var net = networkOf(comp);
  var layout = {
    type: "sportsPin",
    title: (TEAMS[a] || a) + " at " + (TEAMS[h] || h),
    subtitle: formatTime(ev.date),
    body: ((ev.week || {}).text || "NFL game") + (venue ? " at " + venue : "") + (net ? " on " + net : "") + ".",
    tinyIcon: "system://images/AMERICAN_FOOTBALL",
    largeIcon: "system://images/AMERICAN_FOOTBALL",
    lastUpdated: new Date().toISOString(),
    nameAway: a,
    nameHome: h,
    sportsGameState: "pre-game"
  };
  if (as && hs) {
    layout.recordAway = record(as);
    layout.recordHome = record(hs);
  }
  return { id: "nfl-" + ev.id, time: parseDate(ev.date).toISOString(), duration: 210, layout: layout };
}

function syncPins() {
  if (typeof Pebble.insertTimelinePin !== "function") {
    console.log("[NFL] timeline pins aren't supported here");
    return;
  }
  if (!gSettings.timeline) {
    removePins(null);
    localStorage.setItem("pinIds", "[]");
    return;
  }
  getStandings(function (err, standings) {
    nextGame(gSettings.fav, function (err2, upcoming, sched) {
      if (err2 || !sched) {   // can't reach ESPN: leave the pins as they are
        console.log("[NFL] timeline pins skipped: " + err2);
        return;
      }
      var keep = {};
      upcoming.slice(0, PIN_COUNT).forEach(function (ev) {
        var pin = buildPin(ev, standings || []);
        keep[pin.id] = true;
        try {
          Pebble.insertTimelinePin(pin);
        } catch (e) {
          console.log("[NFL] couldn't add pin " + pin.id + ": " + e);
        }
      });
      removePins(keep);
      localStorage.setItem("pinIds", JSON.stringify(Object.keys(keep)));
      console.log("[NFL] timeline pins: " + Object.keys(keep).join(", "));
    });
  });
}

// ── Events ────────────────────────────────────────────────────────────────
Pebble.addEventListener("ready", function () {
  console.log("[NFL] ready, favorite " + gSettings.fav);
  sendSettings();
  syncPins();
});

Pebble.addEventListener("appmessage", function (e) {
  var p = e.payload;
  var req = p.REQ, arg = p.ARG || "";
  if (req === undefined) return;
  switch (req) {
    case REQ_GAMES:     sendGames(arg); break;
    case REQ_GAME:      sendGame(arg); break;
    case REQ_STANDINGS: sendStandings(arg); break;
    case REQ_TEAM:      sendTeam(arg); break;
    case REQ_LEADERS:   sendLeaders(arg); break;
    case REQ_PLAYOFFS:  sendPlayoffs(arg); break;
    case REQ_WEEK:      sendWeek(arg); break;
    case REQ_SETTINGS:  sendSettings(); break;
    case REQ_SET_FAV:
      if (TEAMS[arg]) {
        gSettings.fav = arg;
        saveSettings(gSettings);
        sendSettings();
        syncPins();
      }
      break;
  }
});

// ── Settings page (built here, no website needed) ─────────────────────────
function settingsPage() {
  var abbrs = Object.keys(TEAMS).sort();
  var opts = abbrs.map(function (a) {
    return "<option value='" + a + "'" + (a === gSettings.fav ? " selected" : "") + ">" +
           a + " - " + TEAMS[a] + "</option>";
  }).join("");
  var checks = abbrs.map(function (a) {
    return "<label class='team'><input type='checkbox' name='follow' value='" + a + "'" +
           (gSettings.follow.indexOf(a) >= 0 ? " checked" : "") + "> " + a + "</label>";
  }).join("");
  function toggle(id, label, on) {
    return "<label class='row'><span>" + label + "</span><input type='checkbox' id='" + id + "'" +
           (on ? " checked" : "") + "></label>";
  }
  return "<!DOCTYPE html><html><head><meta charset='utf-8'>" +
    "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<title>NFL Central</title><style>" +
    "body{font-family:-apple-system,sans-serif;background:#111;color:#eee;margin:0;padding:16px}" +
    "h1{font-size:22px}h2{font-size:16px;color:#8c9;margin-top:24px}" +
    "select,button{width:100%;font-size:17px;padding:10px;border-radius:8px}" +
    "button{background:#1a8a3a;color:#fff;border:0;margin-top:24px}" +
    ".row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #333}" +
    ".grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.team{padding:6px 0}" +
    "p{color:#999;font-size:14px}" +
    "</style></head><body><h1>NFL Central</h1>" +
    "<h2>My Team</h2><select id='fav'>" + opts + "</select>" +
    "<h2>Alerts</h2>" +
    toggle("vibrate", "Touchdowns, field goals and safeties", gSettings.vibrate) +
    toggle("redZone", "Red zone: my offense is inside the 20", gSettings.redZone) +
    toggle("closeGame", "Close game: one score in the 4th quarter", gSettings.closeGame) +
    "<p>Alerts work for your team and the teams you follow, while the app is open.</p>" +
    "<h2>Start automatically</h2>" +
    toggle("wake", "Open the app at kickoff", gSettings.wake) +
    toggle("autoOpen", "Open my team's live game at launch", gSettings.autoOpen) +
    "<p>Kickoff start needs the app to be allowed to run in the background on your phone.</p>" +
    "<h2>Timeline</h2>" +
    toggle("timeline", "Add my team's next games to the timeline", gSettings.timeline) +
    "<p>Pins your team's next 5 games to your Pebble timeline. They refresh whenever you open the app, and turning this off removes them.</p>" +
    "<h2>Also follow</h2><p>Get alerts for these teams too, while the app is open.</p>" +
    "<div class='grid'>" + checks + "</div>" +
    "<button id='save'>Save</button>" +
    "<script>document.getElementById('save').onclick=function(){" +
    "var f=[];var c=document.getElementsByName('follow');" +
    "for(var i=0;i<c.length;i++)if(c[i].checked)f.push(c[i].value);" +
    "function on(id){return document.getElementById(id).checked;}" +
    "var s={fav:document.getElementById('fav').value,follow:f," +
    "vibrate:on('vibrate'),redZone:on('redZone'),closeGame:on('closeGame')," +
    "autoOpen:on('autoOpen'),wake:on('wake'),timeline:on('timeline')};" +
    "location.href='pebblejs://close#'+encodeURIComponent(JSON.stringify(s));};</script>" +
    "</body></html>";
}

Pebble.addEventListener("showConfiguration", function () {
  Pebble.openURL("data:text/html;charset=utf-8," + encodeURIComponent(settingsPage()));
});

Pebble.addEventListener("webviewclosed", function (e) {
  if (!e || !e.response || e.response === "CANCELLED") return;
  try {
    var s = JSON.parse(decodeURIComponent(e.response));
    if (TEAMS[s.fav]) gSettings.fav = s.fav;
    gSettings.follow = (s.follow || []).filter(function (a) { return !!TEAMS[a]; });
    ["vibrate", "redZone", "closeGame", "autoOpen", "wake", "timeline"].forEach(function (k) {
      gSettings[k] = !!s[k];
    });
    saveSettings(gSettings);
    sendSettings();
    syncPins();
  } catch (err) {
    console.log("[NFL] bad settings: " + err);
  }
});
