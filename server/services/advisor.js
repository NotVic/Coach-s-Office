// The Assistant page's agent: Claude with a small set of read-only tools
// over this app's own tracked history (player/team snapshots, training log,
// the same derived views the other pages show). It can look things up and
// suggest; it can't change anything — there are no write tools, and the
// tools never expose kv_settings (that's where the CHPP tokens and the
// Anthropic key live).
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const { db, getSetting } = require('../db');
const { computeRecentChanges } = require('./changes');
const { buildTrainingBoard } = require('./trainingBoard');
const { trainingPeriods } = require('./trainingLog');
const { computeCalibration } = require('./calibration');
const { buildMatchPrep } = require('./matchPrep');
const { skillLevelName } = require('../chpp/parse');

const MODEL = 'claude-opus-5-5';
// Upper bound on model calls per user message, so a confused tool loop
// can't run up the bill.
const MAX_TURNS = 10;
// Tool results are capped so one oversized history can't blow the context.
const MAX_TOOL_RESULT_CHARS = 60000;
const MAX_CONVERSATIONS = 50;

const SKILL_KEYS = [
  'skill_keeper', 'skill_defending', 'skill_playmaking', 'skill_winger',
  'skill_passing', 'skill_scoring', 'skill_setpieces', 'skill_stamina',
];

function apiKey() {
  return getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '';
}

function keySource() {
  if (getSetting('anthropic_api_key')) return 'settings';
  if (process.env.ANTHROPIC_API_KEY) return 'env';
  return null;
}

function teamId() {
  return Number(getSetting('chpp_team_id')) || null;
}

function skillsOf(row) {
  const skills = {};
  for (const key of SKILL_KEYS) {
    const level = row[key];
    skills[key.replace('skill_', '')] = level == null ? null : `${level} (${skillLevelName(level)})`;
  }
  return skills;
}

// ---- Tools -------------------------------------------------------------

const NO_INPUT = { type: 'object', properties: {}, additionalProperties: false };

const TOOLS = [
  {
    name: 'get_squad',
    label: 'Reading the squad',
    description: 'Current squad: every active player with age, position, specialty, all eight skills (number and Hattrick level name), TSI, wage, form, experience, leadership, injury, transfer-listed flag, the app\'s value estimate and last match rating. Also the latest team finances and the weekly wage bill. Start here for almost any question.',
    input_schema: NO_INPUT,
    run() {
      const id = teamId();
      if (!id) return { error: 'No squad data yet: connect Hattrick or import a CSV in Settings.' };
      const players = db.prepare('SELECT * FROM players WHERE team_id = ? AND is_active = 1 ORDER BY tsi DESC').all(id);
      const latest = db.prepare('SELECT * FROM team_snapshots WHERE team_id = ? ORDER BY snapshot_date DESC LIMIT 1').get(id);
      return {
        teamName: getSetting('chpp_team_name'),
        dataSource: getSetting('data_source'),
        lastSyncAt: getSetting('last_sync_at'),
        latestTeamSnapshot: latest || null,
        weeklyWageBill: players.reduce((sum, p) => sum + (p.salary || 0), 0),
        players: players.map((p) => ({
          playerId: p.player_id,
          name: `${p.first_name} ${p.last_name}`.trim(),
          ageYears: p.age_years,
          ageDays: p.age_days,
          positionCode: p.position_code,
          specialty: p.specialty,
          skills: skillsOf(p),
          tsi: p.tsi,
          salary: p.salary,
          form: p.form,
          experience: p.experience,
          leadership: p.leadership,
          injuryWeeks: p.injury_weeks,
          transferListed: Boolean(p.transfer_listed),
          valueEstimate: p.value_estimate,
          lastMatchRating: p.last_match_rating,
          lastMatchDate: p.last_match_date,
        })),
      };
    },
  },
  {
    name: 'get_player_history',
    label: 'Reading player history',
    description: 'Every tracked weekly snapshot for one player, oldest first: skills, TSI, value estimate, form, wage, injury, position and the latest match rating at that time. Use it to see trends (skill gains, TSI or value going up or down, form swings). Get player IDs from get_squad.',
    input_schema: {
      type: 'object',
      properties: { player_id: { type: 'integer', description: 'playerId from get_squad' } },
      required: ['player_id'],
      additionalProperties: false,
    },
    run(input) {
      const playerId = input.player_id;
      if (!Number.isInteger(playerId)) return { error: 'player_id must be an integer.' };
      const player = db.prepare('SELECT * FROM players WHERE player_id = ?').get(playerId);
      if (!player) return { error: `No player with id ${playerId}.` };
      const snapshots = db.prepare('SELECT * FROM player_snapshots WHERE player_id = ? ORDER BY snapshot_date ASC').all(playerId);
      return {
        playerId,
        name: `${player.first_name} ${player.last_name}`.trim(),
        ageYears: player.age_years,
        isActive: Boolean(player.is_active),
        snapshots: snapshots.map((s) => ({
          date: s.snapshot_date,
          positionCode: s.position_code,
          tsi: s.tsi,
          valueEstimate: s.value_estimate,
          form: s.form,
          salary: s.salary,
          injuryWeeks: s.injury_weeks,
          lastMatchRating: s.last_match_rating,
          lastMatchDate: s.last_match_date,
          skills: Object.fromEntries(SKILL_KEYS.map((k) => [k.replace('skill_', ''), s[k]])),
        })),
      };
    },
  },
  {
    name: 'get_team_history',
    label: 'Reading team history',
    description: 'Every tracked weekly team snapshot, oldest first: total team TSI, team worth, cash, weekly income and weekly expenses.',
    input_schema: NO_INPUT,
    run() {
      const id = teamId();
      if (!id) return { error: 'No squad data yet.' };
      return {
        snapshots: db.prepare(
          `SELECT snapshot_date, team_tsi, team_worth, cash, weekly_income, weekly_expenses
           FROM team_snapshots WHERE team_id = ? ORDER BY snapshot_date ASC`
        ).all(id),
      };
    },
  },
  {
    name: 'get_training',
    label: 'Checking training',
    description: 'The club\'s training setup (type, intensity, stamina share, coach and assistants), which positions the current training reaches, every player ranked by how close they are to their next level in the trained skill (observed and modeled ETAs), the history of training periods, and how well the training model has matched real level-ups so far (calibration).',
    input_schema: NO_INPUT,
    run() {
      const id = teamId();
      return {
        board: buildTrainingBoard({ assumeFullMinutes: false }),
        periods: trainingPeriods(),
        calibration: id ? computeCalibration(id) : null,
      };
    },
  },
  {
    name: 'get_recent_changes',
    label: 'Checking this week\'s changes',
    description: 'What changed between the two most recent syncs: level-ups, new injuries, recoveries, biggest value movers, team TSI/worth/finance deltas.',
    input_schema: NO_INPUT,
    run() {
      const id = teamId();
      if (!id) return { error: 'No squad data yet.' };
      return computeRecentChanges(id);
    },
  },
  {
    name: 'get_next_match',
    label: 'Looking at the next match',
    description: 'Next fixture (from Hattrick when connected, or entered manually on Match Prep): opponent, date, home/away, a rough TSI-based outcome estimate, the app\'s suggested XI and the availability list.',
    input_schema: NO_INPUT,
    async run() {
      return buildMatchPrep();
    },
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// Tool definitions as the API wants them, built once so the request prefix
// stays byte-identical across calls (prompt caching is a prefix match).
const API_TOOLS = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
  eager_input_streaming: true,
}));

async function runTool(name, input) {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return { content: `Unknown tool: ${name}`, isError: true };
  // With eager input streaming the API no longer validates tool input, so
  // anything that isn't a plain object is treated as a malformed call.
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { content: 'Tool input was not a JSON object.', isError: true };
  }
  try {
    const result = await tool.run(input);
    let text = JSON.stringify(result);
    if (text.length > MAX_TOOL_RESULT_CHARS) {
      text = `${text.slice(0, MAX_TOOL_RESULT_CHARS)}… [truncated: result was ${text.length} characters]`;
    }
    return { content: text, isError: Boolean(result && result.error) };
  } catch (err) {
    return { content: `Tool failed: ${err.message}`, isError: true };
  }
}

// ---- Prompt ------------------------------------------------------------

const SYSTEM_PROMPT = `You are the assistant inside Coach's Office, a self-hosted companion dashboard for one club in Hattrick, the online football manager game. The manager asks you questions; you analyze the club's tracked history and give concrete, actionable suggestions: training choices, who to field, keep, develop or sell, finances, and preparation for the next match.

How to work:
- Look the data up with your tools before answering. Never invent players, numbers or dates. If the data needed isn't there, say what's missing.
- The history comes from weekly snapshots this app took itself, so it may cover only a few weeks. Say how much evidence a conclusion rests on (for example "based on 3 syncs") and be more tentative when it is thin.
- Training ETAs and transfer values in this app are estimates: observed rates from the app's own history, and a community-reverse-engineered training formula (Schum). They are not Hattrick's internal numbers. Treat them as ranges.
- Skill levels use Hattrick's 0-20 scale with names (e.g. 5 = adequate, 7 = excellent). Use the names the tools give you.
- You can't change anything in Hattrick or in this app. Phrase suggestions as things the manager can do.

How to answer:
- Reply in the language the manager writes in.
- Lead with the recommendation, then the evidence behind it. Refer to players by name.
- Keep it compact: short paragraphs, bullet lists, bold for the key point. A small markdown table is fine for comparing a few players.`;

// ---- Conversations -----------------------------------------------------
//
// Kept in memory, server-side, append-only: each assistant turn goes back
// to the API exactly as it came out (thinking blocks included), which the
// model needs for multi-turn tool use. A server restart simply starts
// fresh conversations; nothing here is worth persisting.

const conversations = new Map();

function getConversation(id) {
  if (id && conversations.has(id)) return conversations.get(id);
  if (conversations.size >= MAX_CONVERSATIONS) {
    const oldest = [...conversations.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
    conversations.delete(oldest.id);
  }
  const conv = { id: crypto.randomUUID(), messages: [], busy: false, updatedAt: Date.now() };
  conversations.set(conv.id, conv);
  return conv;
}

/**
 * Runs one user message through the tool loop. `emit(event, data)` gets
 * 'tool' ({ name, label }) and 'text' ({ delta }) events as they happen.
 * On failure or abort the conversation is rolled back to before this
 * message, so a retry starts from a clean, valid history.
 */
async function chat(conv, userText, emit, signal) {
  const key = apiKey();
  if (!key) throw new Error('No Anthropic API key configured. Add one in Settings.');

  const client = new Anthropic({ apiKey: key });
  const startLength = conv.messages.length;
  conv.messages.push({ role: 'user', content: userText });

  try {
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        output_config: { effort: 'high' },
        // If a safety classifier declines, the API retries on a suitable
        // fallback model inside the same call instead of just stopping.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        cache_control: { type: 'ephemeral' },
        system: SYSTEM_PROMPT,
        tools: API_TOOLS,
        messages: conv.messages,
      }, { signal });

      stream.on('text', (delta) => emit('text', { delta }));
      const message = await stream.finalMessage();

      if (message.stop_reason === 'refusal') {
        throw new Error('Claude declined to answer this request.');
      }
      if (message.stop_reason === 'max_tokens') {
        throw new Error('The answer hit the length limit. Try a narrower question.');
      }

      conv.messages.push({ role: 'assistant', content: message.content });

      if (message.stop_reason === 'pause_turn') continue;

      const toolUses = message.content.filter((b) => b.type === 'tool_use');
      if (toolUses.length === 0) {
        conv.updatedAt = Date.now();
        return;
      }

      // All results go back in one user message (parallel tool calls).
      const results = [];
      for (const use of toolUses) {
        emit('tool', { name: use.name, label: TOOLS_BY_NAME.get(use.name)?.label ?? use.name });
        const { content, isError } = await runTool(use.name, use.input);
        results.push({ type: 'tool_result', tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
      }
      conv.messages.push({ role: 'user', content: results });
      // Separates text written before and after a round of tool calls.
      emit('text', { delta: '\n\n' });
    }
    throw new Error(`Stopped after ${MAX_TURNS} steps without a final answer. Try a more specific question.`);
  } catch (err) {
    conv.messages.length = startLength;
    throw err;
  }
}

/** Turns an SDK error into something worth showing the manager. */
function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check it in Settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key has no access to the model. Check your Anthropic account.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API. Wait a moment and try again.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check the server\'s internet connection.';
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ''}: ${err.message}`.trim();
  return err.message;
}

/** Cheap check that a key works, used when saving one in Settings. */
async function verifyKey(key) {
  const client = new Anthropic({ apiKey: key, maxRetries: 0 });
  await client.models.retrieve(MODEL);
}

module.exports = { chat, getConversation, describeError, verifyKey, keySource, MODEL, Anthropic };
