import 'dotenv/config'; // Loads environment variables from .env file
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import pkg from 'pg';
import { Server } from 'socket.io'; // Import Socket.IO Server
import http from 'http'; // For HTTP server creation
import fetch from 'node-fetch'; // For external API calls like SendGrid

const { Pool } = pkg;
const { DATABASE_URL, PGHOST, PGDATABASE, PGUSER, PGPASSWORD, PGPORT = 5432 } = process.env;

const pool = new Pool(
  DATABASE_URL
    ? {
        connectionString: DATABASE_URL,
        ssl: { require: true }
      }
    : {
        host: PGHOST,
        database: PGDATABASE,
        user: PGUSER,
        password: PGPASSWORD,
        port: Number(PGPORT),
        ssl: { require: true },
      }
);

const app = express();
const server = http.createServer(app); // Create HTTP server from Express app
const io = new Server(server, { // Initialize Socket.IO with the HTTP server
  cors: {
    origin: "*", // Allow all origins for development
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const EMAIL_VERIFICATION_SECRET = process.env.EMAIL_VERIFICATION_SECRET || 'email_secret';
const PASSWORD_RESET_SECRET = process.env.PASSWORD_RESET_SECRET || 'password_secret';

// SendGrid Configuration
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_SENDER_EMAIL = process.env.SENDGRID_SENDER_EMAIL || 'noreply@aetherflow.com';
const SENDGRID_SENDER_NAME = process.env.SENDGRID_SENDER_NAME || 'AetherFlow Support';
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;


// ESM workaround for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure storage directory exists
const STORAGE_DIR = path.join(__dirname, 'storage');
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

/*
  Multer setup for file uploads.
  Files are stored in the './storage' directory with unique filenames.
*/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, STORAGE_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());
app.use(morgan((tokens, req, res) => {
  return [
    tokens.method(req, res),
    tokens.url(req, res),
    tokens.status(req, res),
    tokens.res(req, res, 'content-length'), '-',
    tokens['response-time'](req, res), 'ms',
    'Params:', JSON.stringify(req.params),
    'Query:', JSON.stringify(req.query),
    'Body:', JSON.stringify(req.body),
    'Headers:', JSON.stringify(req.headers)
  ].join(' ');
}));

// Serve static files from the 'public' directory (for SPA frontend)
app.use(express.static(path.join(__dirname, 'public')));
// Serve dynamically uploaded files from the 'storage' directory
app.use('/storage', express.static(STORAGE_DIR));

// --- Global ID Sequence Management (In-memory, initialized from DB) ---
const id_sequences = {
  user: 0, project: 0, project_member: 0, issue: 0, comment: 0, attachment: 0,
  label: 0, issue_label: 0, issue_link: 0, activity_log: 0, notification: 0
};

/**
 * Initializes the global ID sequences by querying the max ID from each table.
 * This is a workaround to ensure sequential IDs (e.g., 'user-101') are
 * unique and increment correctly after server restarts, considering the
 * 'TEXT PRIMARY KEY' format in the DB schema.
 * This function handles the "prefix-number" format.
 */
async function initialize_id_sequences() {
  const client = await pool.connect();
  try {
    const tables = {
      users: 'user', projects: 'proj', project_members: 'pm', issues: 'issue',
      comments: 'comm', attachments: 'att', labels: 'label', issue_labels: 'isl',
      issue_links: 'ilk', activity_logs: 'act', notifications: 'notif'
    };

    for (const [tableName, prefix] of Object.entries(tables)) {
      const result = await client.query(`SELECT id FROM ${tableName}`);
      let maxNum = 0;
      for (const row of result.rows) {
        const id = row.id;
        const match = id.match(/-(\d+)$/);
        if (match && parseInt(match[1]) > maxNum) {
          maxNum = parseInt(match[1]);
        }
      }
      id_sequences[prefix.replace('proj', 'project').replace('pm', 'project_member').replace('comm', 'comment').replace('att', 'attachment')
          .replace('isl', 'issue_label').replace('ilk', 'issue_link').replace('act', 'activity_log').replace('notif', 'notification').replace('user','user')] = maxNum;
      console.log(`Initialized ${prefix} sequence to ${maxNum}`);
    }
  } catch (error) {
    console.error('Error initializing ID sequences:', error);
  } finally {
    client.release();
  }
}

/**
 * Generates the next sequential ID for a given entity prefix.
 * @param {string} prefix The prefix for the ID (e.g., 'user', 'issue').
 * @returns {string} The newly generated unique ID.
 */
function get_next_id(prefix) {
  const key = prefix.replace('proj', 'project').replace('pm', 'project_member').replace('comm', 'comment').replace('att', 'attachment')
  .replace('isl', 'issue_label').replace('ilk', 'issue_link').replace('act', 'activity_log').replace('notif', 'notification').replace('user','user');
  id_sequences[key]++;
  return `${prefix}-${id_sequences[key]}`;
}


// --- Middleware ---

/**
 * Middleware to authenticate JWT tokens.
 * Extracts user ID from the token and attaches it to `req.user_id`.
 */
const authenticate_jwt = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: 'Authorization token not provided.' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Authorization token malformed.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user_id = decoded.user_id;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid or expired token.', error: error.message });
  }
};

/**
 * Checks if the authenticated user is a member of the specified project and returns their role.
 * @param {string} project_id The ID of the project.
 * @param {string} user_id The ID of the user.
 * @returns {Promise<string|null>} The user's role ('Admin', 'Member') or null if not a member.
 */
async function check_project_membership(project_id, user_id) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [project_id, user_id]
    );
    return result.rows.length > 0 ? result.rows[0].role : null;
  } finally {
    client.release();
  }
}

/**
 * Middleware to check if the authenticated user has Project Admin role.
 */
const check_project_admin = async (req, res, next) => {
  const { project_id } = req.params;
  const user_id = req.user_id;

  if (!project_id) {
    return res.status(400).json({ message: 'Project ID is required.' });
  }

  const role = await check_project_membership(project_id, user_id);
  if (role !== 'Admin') {
    return res.status(403).json({ message: 'Forbidden: Only Project Admins can perform this action.' });
  }
  next();
};

/**
 * Middleware to check if the authenticated user is a member of the project.
 */
const check_project_member = async (req, res, next) => {
  const project_id = req.params.project_id || req.body.project_id; // project_id can be in params or body
  const user_id = req.user_id;

  if (!project_id) {
    return res.status(400).json({ message: 'Project ID is required.' });
  }

  const role = await check_project_membership(project_id, user_id);
  if (!role) {
    return res.status(403).json({ message: 'Forbidden: User is not a member of this project.' });
  }
  next();
};

/**
 * Middleware to check if the authenticated user is a member of the issue's project.
 */
const check_issue_project_member = async (req, res, next) => {
  const { issue_id } = req.params;
  const user_id = req.user_id;

  const client = await pool.connect();
  try {
    const issueResult = await client.query(`SELECT project_id FROM issues WHERE id = $1`, [issue_id]);
    if (issueResult.rows.length === 0) {
      return res.status(404).json({ message: 'Issue not found.' });
    }
    const projectId = issueResult.rows[0].project_id;

    const role = await check_project_membership(projectId, user_id);
    if (!role) {
      return res.status(403).json({ message: 'Forbidden: User is not a member of this project.' });
    }
    next();
  } catch (error) {
    console.error('Error checking issue project membership:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
};


// --- Data Transformation / Utility Functions ---

/**
 * @typedef {Object} UserMinDetails
 * @property {string} id
 * @property {string} first_name
 * @property {string} last_name
 * @property {string | null} profile_picture_url
 */

/**
 * Maps a database user row to a UserMinDetails object for API responses.
 * @param {object} row The user row from the database.
 * @returns {UserMinDetails}
 */
const map_user_min_details = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    profile_picture_url: row.profile_picture_url || null,
  };
};

/**
 * @typedef {Object} ProjectSummary
 * @property {string} id
 * @property {string} project_name
 * @property {string} project_key
 */

/**
 * Maps a database project row to a ProjectSummary object.
 * @param {object} row The project row from the database.
 * @returns {ProjectSummary}
 */
const map_project_summary = (row) => {
  if (!row) return null; // Handle case where project is not found for summary
  return {
    id: row.project_id || row.id, // Can come from issues table join (project_id) or projects table directly
    project_name: row.project_name,
    project_key: row.project_key,
  };
};

/**
 * Derives the issue key from project key and issue ID.
 * Since issue IDs are TEXT (e.g., 'issue-401'), we extract the numeric part.
 * @param {string} project_key
 * @param {string} issue_id
 * @returns {string} The derived issue key (e.g., 'WEB-401').
*/
const derive_issue_key = (project_key, issue_id) => {
  if (!project_key || !issue_id) return '';
  const match = issue_id.match(/-(\d+)$/);
  const numeric_part = match ? match[1] : '';
  return `${project_key}-${numeric_part}`;
};

/**
 * @typedef {Object} ActivityLogSchema
 * @property {string} id
 * @property {UserMinDetails} user
 * @property {string} action_type
 * @property {string | null} field_name
 * @property {string | null} old_value
 * @property {string | null} new_value
 * @property {object | null} comment (partial comment schema)
 * @property {string} created_at (ISO datetime string)
 */

/**
 * Maps activity log data from DB rows to API schema.
 * Includes user details and partial comment details where applicable.
 * @param {object} client - pg client for queries
 * @param {object} row - The activity log row from the database.
 * @returns {Promise<ActivityLogSchema>}
 */
async function map_activity_log(client, row) {
  const user_details = await map_user_min_details_from_db(client, row.user_id);

  let comment = null;
  if (row.comment_id) {
    const comment_details = await client.query(`SELECT id, comment_content, created_at, updated_at, deleted_at FROM comments WHERE id = $1`, [row.comment_id]);
    if (comment_details.rows.length > 0) {
      comment = {
        id: comment_details.rows[0].id,
        content: comment_details.rows[0].comment_content,
        created_at: comment_details.rows[0].created_at,
        updated_at: comment_details.rows[0].updated_at,
        deleted_at: comment_details.rows[0].deleted_at,
      };
    }
  }

  return {
    id: row.id,
    user: user_details,
    action_type: row.action_type,
    field_name: row.field_name,
    old_value: row.old_value,
    new_value: row.new_value,
    comment: comment,
    created_at: row.created_at,
  };
}

/**
 * Emits a real-time event via Socket.IO.
 * Joins appropriate rooms based on event type to ensure relevant clients receive the update.
 * @param {string} event_name The name of the WebSocket event.
 * @param {object} data The payload for the event.
 * @param {string | null} user_id Specific user ID for targeted notifications.
 * @param {string | null} project_id Project ID for board/project-specific updates.
 * @param {string | null} issue_id Issue ID for issue-specific activity.
 */
async function emit_websocket_event(event_name, data, user_id = null, project_id = null, issue_id = null) {
  // Emit to specific user room for notifications
  if (user_id) {
    io.to(`users/${user_id}/notifications`).emit(event_name, { type: event_name, data });
  }

  // Emit to project board room for status updates
  if (project_id && event_name.startsWith('issue_status_updated')) { // Added startsWith for flexibility
    io.to(`projects/${project_id}/board`).emit(event_name, { type: event_name, data });
  }

  // Emit to issue activity room for comments and general issue details updates
  if (issue_id && (event_name.startsWith('issue_comment_added') || event_name.startsWith('issue_details_updated'))) { // Added startsWith
    io.to(`issues/${issue_id}/activity`).emit(event_name, { type: event_name, data });
  }
}

/**
 * Centralized function to create and manage activity logs and notifications.
 * @param {object} client - pg client for queries
 * @param {string} issue_id
 * @param {string} user_id - The user who performed the action
 * @param {string} action_type - Type of action ('issue_created', 'status_changed', etc.)
 * @param {object} options - Optional fields like field_name, old_value, new_value, comment_id, project_key, assignee_user_id, reporter_user_id, mentioned_users
 */
async function create_activity_and_notify(client, issue_id, user_id, action_type, options = {}) {
  const { field_name, old_value, new_value, comment_id, project_key: option_project_key, assignee_user_id: option_assignee, reporter_user_id: option_reporter, mentioned_users = [] } = options;
  const now = new Date().toISOString();

  // Fetch essential issue and project details
  const issue_data_res = await client.query(`
    SELECT
      i.summary, i.issue_type, i.project_id, i.reporter_user_id, i.assignee_user_id,
      p.project_key
    FROM issues i
    JOIN projects p ON i.project_id = p.id
    WHERE i.id = $1`, [issue_id]);

  if (issue_data_res.rows.length === 0) {
    console.warn(`Attempted to create activity/notification for non-existent issue ${issue_id}.`);
    return;
  }
  const issue_details = issue_data_res.rows[0];
  const issue_summary_text = issue_details.summary;
  const issue_project_id = issue_details.project_id;
  const project_key = issue_details.project_key; // Use DB fetched project_key

  // Fetch actor_user_details (user who triggered the action)
  const actor_user_details = await map_user_min_details_from_db(client, user_id);

  // 1. Create activity log entry
  const activity_id = get_next_id('act');
  await client.query(
    `INSERT INTO activity_logs (id, issue_id, user_id, action_type, field_name, old_value, new_value, comment_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [activity_id, issue_id, user_id, action_type, field_name, old_value, new_value, comment_id, now]
  );
  // Prepare activity log entry for WebSocket payload
  const new_activity_log_entry = await map_activity_log(client, { id: activity_id, issue_id, user_id, action_type, field_name, old_value, new_value, comment_id, created_at: now });


  // 2. Generate notifications and emit WebSocket events
  const notification_targets = new Set();
  let reporter_id = issue_details.reporter_user_id;
  let current_assignee_id = issue_details.assignee_user_id;

  // Add reporter and current assignee to notification targets if they exist and are not the actor
  if (reporter_id && reporter_id !== user_id) notification_targets.add(reporter_id);
  if (current_assignee_id && current_assignee_id !== user_id) notification_targets.add(current_assignee_id);

  // Add mentioned users to notification targets
  if (mentioned_users.length > 0) {
    mentioned_users.forEach(mentioned_id => {
      // Ensure mentioned user is not the actor and is a valid user
      if (mentioned_id && mentioned_id !== user_id) notification_targets.add(mentioned_id);
    });
  }

  let notification_type, summary_text;
  let comment_summary_for_notification = null; // For new_comment notification data

  // Handle specific notification types and summary text
  switch (action_type) {
    case 'issue_created':
      notification_type = 'issue_updated'; // Or 'issue_created' if that notification type exists
      summary_text = `New ${issue_details.issue_type} ${derive_issue_key(project_key, issue_id)}: "${issue_summary_text}" was created.`;
      break;
    case 'status_changed':
      notification_type = 'status_change';
      summary_text = `${actor_user_details.first_name} ${actor_user_details.last_name} changed status of ${derive_issue_key(project_key, issue_id)} to ${new_value}.`;
      break;
    case 'assignee_changed':
      // Special handling: notify old assignee if unassigned, new assignee 'assigned_to_you'
      if (old_value && old_value !== user_id) { // Old assignee, if they were assigned
          const oldAssigneeSummary = `${actor_user_details.first_name} ${actor_user_details.last_name} unassigned you from ${derive_issue_key(project_key, issue_id)}.`;
          await create_single_notification(client, old_value, issue_id, 'issue_updated', user_id, oldAssigneeSummary, derive_issue_key(project_key, issue_id), issue_summary_text, project_key);
          emit_websocket_event('notification_new_unread', {
              id: get_next_id('notif'), // Temp ID, gets replaced by DB ID
              issue_id: issue_id, issue_key: derive_issue_key(project_key, issue_id), issue_summary: issue_summary_text,
              project_key: project_key, notification_type: 'issue_updated', actor: actor_user_details,
              summary_text: oldAssigneeSummary, is_read: false, created_at: now
          }, old_value);
      }
      if (new_value && new_value !== user_id) { // New assignee
        notification_targets.add(new_value); // Ensure new assignee gets it
        const newAssigneeSummary = `You were assigned to ${derive_issue_key(project_key, issue_id)}: "${issue_summary_text}".`;
        await create_single_notification(client, new_value, issue_id, 'assigned_to_you', user_id, newAssigneeSummary, derive_issue_key(project_key, issue_id), issue_summary_text, project_key);
        emit_websocket_event('notification_new_unread', {
            id: get_next_id('notif'), // Temp ID, gets replaced by DB ID
            issue_id: issue_id, issue_key: derive_issue_key(project_key, issue_id), issue_summary: issue_summary_text,
            project_key: project_key, notification_type: 'assigned_to_you', actor: actor_user_details,
            summary_text: newAssigneeSummary, is_read: false, created_at: now
        }, new_value);
      }
      notification_type = 'issue_updated'; // Default for other involved users
      summary_text = `${actor_user_details.first_name} ${actor_user_details.last_name} changed assignee for ${derive_issue_key(project_key, issue_id)}.`;
      break;
    case 'comment_added':
      notification_type = 'new_comment';
       // Fetch comment content for summary, if available
      if (comment_id) {
        const comment_content_res = await client.query(`SELECT comment_content FROM comments WHERE id = $1`, [comment_id]);
        if (comment_content_res.rows.length > 0) {
          comment_summary_for_notification = { id: comment_id, content: comment_content_res.rows[0].comment_content };
        }
      }
      summary_text = `${actor_user_details.first_name} ${actor_user_details.last_name} commented on ${derive_issue_key(project_key, issue_id)}: "${issue_summary_text}".`;
      // For @mentions, directly add to targets for specific notification
      for (const mentioned_id of mentioned_users) {
        if (mentioned_id !== user_id && !notification_targets.has(mentioned_id)) { // Prevent double notification
          await create_single_notification(client, mentioned_id, issue_id, 'mentioned', user_id, `${actor_user_details.first_name} ${actor_user_details.last_name} mentioned you in a comment on ${derive_issue_key(project_key, issue_id)}.`, derive_issue_key(project_key, issue_id), issue_summary_text, project_key, { commented_id: comment_id });
          emit_websocket_event('notification_new_unread', {
              id: get_next_id('notif'), issue_id: issue_id, issue_key: derive_issue_key(project_key, issue_id), issue_summary: issue_summary_text,
              project_key: project_key, notification_type: 'mentioned', actor: actor_user_details, comment: comment_summary_for_notification,
              summary_text: `${actor_user_details.first_name} ${actor_user_details.last_name} mentioned you in a comment on ${derive_issue_key(project_key, issue_id)}.`, is_read: false, created_at: now
          }, mentioned_id);
          notification_targets.delete(mentioned_id); // Prevent general 'new_comment' notification for them
        }
      }
      break;
    case 'comment_edited':
      notification_type = 'issue_updated';
      if (comment_id) {
        const comment_content_res = await client.query(`SELECT comment_content FROM comments WHERE id = $1`, [comment_id]);
        if (comment_content_res.rows.length > 0) {
          comment_summary_for_notification = { id: comment_id, content: comment_content_res.rows[0].comment_content };
        }
      }
      summary_text = `${actor_user_details.first_name} ${actor_user_details.last_name} edited a comment on ${derive_issue_key(project_key, issue_id)}.`;
      break;
    case 'comment_deleted':
      notification_type = 'issue_updated';
      summary_text = `${actor_user_details.first_name} ${actor_user_details.last_name} deleted a comment on ${derive_issue_key(project_key, issue_id)}.`;
      break;
    case 'issue_linked':
    case 'issue_unlinked':
        notification_type = action_type; // 'issue_linked' or 'issue_unlinked'
        summary_text = `${actor_user_details.first_name} ${actor_user_details.last_name} ${action_type === 'issue_linked' ? 'linked' : 'unlinked'} ${derive_issue_key(project_key, issue_id)}.`;
        break;
    case 'label_added':
    case 'label_removed':
    case 'attachment_added':
    case 'attachment_removed':
    case 'summary_updated':
    case 'description_updated':
    case 'priority_changed':
    case 'due_date_changed':
    case 'subtask_created':
    case 'parent_issue_changed':
      notification_type = 'issue_updated';
      summary_text = `${actor_user_details.first_name} ${actor_user_details.last_name} updated ${field_name || 'the issue'} on ${derive_issue_key(project_key, issue_id)}.`;
      break;
    default:
      // No notification for this action_type
      return;
  }

  // Create notifications for all determined targets
  for (const target_user_id of notification_targets) {
    if (target_user_id === user_id) continue; // Don't notify self unless explicitly logic (like assignee_changed already has it)

    await create_single_notification(client, target_user_id, issue_id, notification_type, user_id, summary_text, derive_issue_key(project_key, issue_id), issue_summary_text, project_key, { comment_id });

    // Emit WebSocket event for notification
    emit_websocket_event('notification_new_unread', {
      id: get_next_id('notif'), // Placeholder ID, will be updated by DB
      issue_id: issue_id,
      issue_key: derive_issue_key(project_key, issue_id),
      issue_summary: issue_summary_text,
      project_key: project_key,
      notification_type: notification_type,
      actor: actor_user_details,
      comment: comment_summary_for_notification,
      summary_text: summary_text,
      is_read: false, created_at: now
    }, target_user_id);
  }

  // Emit general issue activity event to WebSocket
  // This will trigger 'issue_details_updated' on the client side
  // or 'issue_comment_added' for comments
  if (action_type === 'comment_added') {
    emit_websocket_event('issue_comment_added', {
      issue_id: issue_id,
      comment: {
        id: comment_id,
        user: actor_user_details,
        comment_content: comment_summary_for_notification ? comment_summary_for_notification.content : '',
        created_at: now
      }
    }, null, issue_project_id, issue_id); // Broadcast to issue's activity feed room
  } else if (action_type === 'status_changed') {
    const issue_info_for_board_res = await client.query(`
      SELECT
        i.id, i.summary, i.status, i.priority, i.assignee_user_id, i.project_id,
        u.first_name, u.last_name, u.profile_picture_url, p.project_key
      FROM issues i
      JOIN projects p ON i.project_id = p.id
      LEFT JOIN users u ON i.assignee_user_id = u.id
      WHERE i.id = $1
    `, [issue_id]);

    if (issue_info_for_board_res.rows.length > 0) {
      const row = issue_info_for_board_res.rows[0];
      const issue_key_for_board = derive_issue_key(row.project_key, row.id);
      emit_websocket_event('issue_status_updated', {
        id: row.id,
        project_id: row.project_id,
        status: row.status,
        old_status: old_value, // Old value is needed for this notification
        updated_by: actor_user_details,
        updated_at: now,
        issue_summary: {
          id: row.id,
          issue_key: issue_key_for_board,
          summary: row.summary,
          assignee: map_user_min_details(row), // Assignee details for Kanban card
          priority: row.priority
        }
      }, null, issue_project_id); // Broadcast to project board
    }
  } else {
    // For all other actions, emit issue_details_updated
    // Fetch current issue data to send in the payload
    const updated_issue_res = await client.query(`
      SELECT
        i.id, i.summary, i.description, i.assignee_user_id, i.priority, i.due_date,
        i.status, i.reporter_user_id, i.parent_issue_id, i.rank, i.issue_type, i.project_id,
        p.project_key, p.project_name
      FROM issues i JOIN projects p ON i.project_id = p.id WHERE i.id = $1
    `, [issue_id]);

    if (updated_issue_res.rows.length > 0) {
      const full_issue_details_row = updated_issue_res.rows[0];
      const issue_key_full = derive_issue_key(full_issue_details_row.project_key, full_issue_details_row.id);

      const [
          assignee_details_full, reporter_details_full,
          labels_full, attachments_full, sub_tasks_full, linked_issues_full
      ] = await Promise.all([
          full_issue_details_row.assignee_user_id ? map_user_min_details_from_db(client, full_issue_details_row.assignee_user_id) : null,
          map_user_min_details_from_db(client, full_issue_details_row.reporter_user_id),
          client.query(`SELECT l.id, l.label_name FROM labels l JOIN issue_labels il ON l.id = il.label_id WHERE il.issue_id = $1`, [issue_id]),
          client.query(`SELECT a.id, a.issue_id, a.file_name, a.file_url, a.mime_type, a.file_size, a.uploaded_by_user_id, a.created_at, u.first_name, u.last_name, u.profile_picture_url FROM attachments a JOIN users u ON a.uploaded_by_user_id = u.id WHERE a.issue_id = $1`, [issue_id]),
          client.query(`SELECT id, summary, assignee_user_id, status FROM issues WHERE parent_issue_id = $1`, [issue_id]),
          client.query(`SELECT il.target_issue_id AS id, i.summary, p.project_key, il.link_type FROM issue_links il JOIN issues i ON il.target_issue_id = i.id JOIN projects p ON i.project_id = p.id WHERE il.source_issue_id = $1`, [issue_id])
      ]);

      const updated_fields_payload = {
                  id: full_issue_details_row.id,
                  issue_type: full_issue_details_row.issue_type,
                  summary: full_issue_details_row.summary,
                  description: full_issue_details_row.description,
                  assignee: assignee_details_full,
                  reporter: reporter_details_full,
                  priority: full_issue_details_row.priority,
                  status: full_issue_details_row.status,
                  due_date: full_issue_details_row.due_date,
                  parent_issue_id: full_issue_details_row.parent_issue_id,
                  rank: full_issue_details_row.rank,
                  created_at: full_issue_details_row.created_at,
                  updated_at: full_issue_details_row.updated_at,
                  issue_key: issue_key_full,
                  project_summary: map_project_summary(full_issue_details_row),
                  labels: labels_full.rows.map(row => ({ id: row.id, label_name: row.label_name })),
                  attachments: attachments_full.rows.map(row => ({id: row.id, file_name: row.file_name, file_url: row.file_url, mime_type: row.mime_type, file_size: row.file_size, uploaded_by: map_user_min_details(row), created_at: row.created_at})),
                  sub_tasks: await Promise.all(sub_tasks_full.rows.map(async row => ({id: row.id, summary: row.summary, assignee: row.assignee_user_id ? await map_user_min_details_from_db(client, row.assignee_user_id) : null, status: row.status}))),
                  linked_issues: linked_issues_full.rows.map(row => ({id: row.id, issue_key: derive_issue_key(row.project_key, row.id), summary: row.summary, project_key: row.project_key, link_type: row.link_type})),
      };

      emit_websocket_event('issue_details_updated', {
          issue_id: issue_id,
          updated_fields: updated_fields_payload, // Sending comprehensive issue details
          activity_log_entry: new_activity_log_entry,
          updated_by: actor_user_details,
          updated_at: now
      }, null, issue_project_id, issue_id); // Broadcast to issue's activity feed room
    }
  }
}


/**
 * Helper to create a single notification entry in the database.
 * @param {object} client - pg client for queries
 * @param {string} target_user_id - User who receives the notification
 * @param {string} issue_id - Related issue ID
 * @param {string} notification_type - Type of notification
 * @param {string} actor_user_id - User who performed the action
 * @param {string} summary_text - Display text for the notification
 * @param {string} issue_key_for_notification - Derived issue key for easy display in notification
 * @param {string} issue_summary_text - Issue's summary text for notification content
 * @param {string} project_key - Project's key for notification content
 * @param {object} [options={}] - Additional options like comment_id
 */
async function create_single_notification(client, target_user_id, issue_id, notification_type, actor_user_id, summary_text, issue_key_for_notification, issue_summary_text, project_key, options = {}) {
  const now = new Date().toISOString();
  const notification_id = get_next_id('notif');
  await client.query(
    `INSERT INTO notifications (id, user_id, issue_id, notification_type, actor_user_id, comment_id, summary_text, is_read, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [notification_id, target_user_id, issue_id, notification_type, actor_user_id, options.comment_id || null, summary_text, false, now]
  );
}

/**
 * Fetches user details from the database and maps to minimal user details.
 * @param {object} client - pg client for queries
 * @param {string} user_id - The ID of the user to fetch.
 * @returns {Promise<UserMinDetails | null>}
 */
async function map_user_min_details_from_db(client, user_id) {
  if (!user_id) return null; // Handle null assignee/reporter
  const user_result = await client.query(
    `SELECT id, first_name, last_name, profile_picture_url FROM users WHERE id = $1`,
    [user_id]
  );
  if (user_result.rows.length > 0) {
    return map_user_min_details(user_result.rows[0]);
  }
  return null;
}

// --- Socket.IO Authentication ---
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error: Token not provided.'));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user_id = decoded.user_id; // Attach user_id to socket object
    next();
  } catch (error) {
    return next(new Error('Authentication error: Invalid or expired token.'));
  }
});


// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id} (User: ${socket.user_id})`);

  // Join user's personal notification room
  socket.join(`users/${socket.user_id}/notifications`);
  console.log(`User ${socket.user_id} joined room: users/${socket.user_id}/notifications`);

  // Allow client to join project-specific rooms
  socket.on('join_project_room', async (projectId) => {
    // Optional: Add logic to verify if socket.user_id is a member of projectId
    const role = await check_project_membership(projectId, socket.user_id);
    if (role) {
      socket.join(`projects/${projectId}/board`);
      console.log(`User ${socket.user_id} joined board room for project ${projectId}`);
    } else {
      console.warn(`User ${socket.user_id} attempted to join project ${projectId} board room without permission.`);
    }
  });

  // Allow client to join issue-specific activity rooms
  socket.on('join_issue_room', async (issueId) => {
      const client = await pool.connect();
      try {
          const issueResult = await client.query(`SELECT project_id FROM issues WHERE id = $1`, [issueId]);
          if (issueResult.rows.length === 0) {
              console.warn(`Attempted to join room for non-existent issue ${issueId}`);
              return;
          }
          const projectId = issueResult.rows[0].project_id;
          const role = await check_project_membership(projectId, socket.user_id);
          if (role) {
              socket.join(`issues/${issueId}/activity`);
              console.log(`User ${socket.user_id} joined activity room for issue ${issueId}`);
          } else {
              console.warn(`User ${socket.user_id} attempted to join issue ${issueId} activity room without permission.`);
          }
      } catch (error) {
          console.error(`Error joining issue room ${issueId}:`, error);
      } finally {
          client.release();
      }
  });


  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id} (User: ${socket.user_id})`);
  });
});


// --- API Routes ---

// II.B.1. User Registration
app.post('/api/v1/auth/register', async (req, res) => {
  const { email, password, first_name, last_name } = req.body;
  if (!email || !password || !first_name || !last_name) {
    return res.status(400).json({ message: 'All fields are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
  }

  const client = await pool.connect();
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const email_verification_token = jwt.sign({ email }, EMAIL_VERIFICATION_SECRET, { expiresIn: '1h' });
    const user_id = get_next_id('user');
    const now = new Date().toISOString();

    await client.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, email_verified, email_verification_token, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, $8)`,
      [user_id, email, hashedPassword, first_name, last_name, email_verification_token, now, now]
    );

    // @@update:external-api : Send a verification email to the user using SendGrid.
    const verificationLink = `${APP_BASE_URL}/api/v1/auth/verify_email?token=${email_verification_token}`;
    const sendgridPayload = {
        personalizations: [
            {
                to: [
                    {
                        email: email,
                        name: `${first_name} ${last_name}`
                    }
                ],
                subject: 'Please Verify Your Email Address for AetherFlow'
            }
        ],
        from: {
            email: SENDGRID_SENDER_EMAIL,
            name: SENDGRID_SENDER_NAME
        },
        content: [
            {
                type: 'text/plain',
                value: `Hello ${first_name},\n\nPlease verify your email address by clicking on the following link: ${verificationLink}\n\nIf you did not register for this service, please ignore this email.\n\nThank You,\nAetherFlow Team`
            },
            {
                type: 'text/html',
                value: `
                <p>Hello <strong>${first_name}</strong>,</p>
                <p>Please verify your email address by clicking on the following link:</p>
                <p><a href="${verificationLink}">Click here to verify your email</a></p>
                <p>If the link doesn't work, copy and paste this URL into your browser: <code>${verificationLink}</code></p>
                <p>If you did not register for this service, please ignore this email.</p>
                <p>Thank You,<br/>AetherFlow Team</p>
                `
            }
        ]
    };

    if (SENDGRID_API_KEY) {
      try {
          const sendgridResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${SENDGRID_API_KEY}`
              },
              body: JSON.stringify(sendgridPayload)
          });

          if (!sendgridResponse.ok) {
              const errorData = await sendgridResponse.json();
              console.error('Failed to send verification email via SendGrid:', sendgridResponse.status, errorData);
              return res.status(500).json({ message: 'User registered, but failed to send verification email. Please contact support.' });
          }
      } catch (emailError) {
          console.error('Error sending verification email:', emailError);
          return res.status(500).json({ message: 'User registered, but an unexpected error occurred while sending verification email. Please contact support.' });
      }
    } else {
      console.warn(`SENDGRID_API_KEY is not set. Not sending verification email.`);
      console.log(`Mock Email Verification: Send this link to ${email}: ${verificationLink}`);
    }

    res.status(200).json({ message: 'User registered successfully. Please check your email for verification.' });
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ message: 'Email already registered.' });
    }
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error during registration.' });
  } finally {
    client.release();
  }
});

// II.B.2. Email Verification
app.get('/api/v1/auth/verify_email', async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ message: 'Verification token is missing.' });
  }

  const client = await pool.connect();
  try {
    const decoded = jwt.verify(token, EMAIL_VERIFICATION_SECRET);
    const { email } = decoded;
    const now = new Date().toISOString();

    const result = await client.query(
      `UPDATE users SET email_verified = TRUE, email_verification_token = NULL, updated_at = $1 WHERE email = $2 AND email_verification_token = $3 RETURNING id`,
      [now, email, token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired verification token.' });
    }

    res.status(200).json({ message: 'Email verified successfully.' });
  } catch (error) {
    console.error('Email verification error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(400).json({ message: 'Verification token has expired.' });
    }
    res.status(500).json({ message: 'Internal server error during email verification.' });
  } finally {
    client.release();
  }
});

// II.B.3. User Login
app.post('/api/v1/auth/login', async (req, res) => {
  const { email, password, remember_me } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT id, password_hash, email_verified FROM users WHERE email = $1`, [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const user = result.rows[0];
    if (!user.email_verified) {
      return res.status(401).json({ message: 'Account not verified. Please check your email.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const expiresIn = remember_me ? '7d' : '1h';
    const token = jwt.sign({ user_id: user.id }, JWT_SECRET, { expiresIn });

    res.status(200).json({ user_id: user.id, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error during login.' });
  } finally {
    client.release();
  }
});

// II.B.4. Forgot Password
app.post('/api/v1/auth/forgot_password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: 'Email is required.' });
  }

  const client = await pool.connect();
  try {
    const userResult = await client.query(`SELECT id, first_name FROM users WHERE email = $1`, [email]);
    if (userResult.rows.length === 0) {
      // Return 200 OK even if user not found to prevent email enumeration
      return res.status(200).json({ message: 'Password reset link sent if email exists.' });
    }

    const user_id = userResult.rows[0].id;
    const first_name = userResult.rows[0].first_name;
    const reset_token = jwt.sign({ user_id }, PASSWORD_RESET_SECRET, { expiresIn: '1h' });
    const now = new Date().toISOString();

    await client.query(
      `UPDATE users SET password_reset_token = $1, updated_at = $2 WHERE id = $3`,
      [reset_token, now, user_id]
    );

    // @@update:external-api : Send password reset email with the reset_token using SendGrid.
    const resetLink = `${APP_BASE_URL}/reset-password?token=${reset_token}`; // Frontend route for reset
        const sendgridPayload = {
            personalizations: [
                {
                    to: [
                        {
                            email: email,
                            name: first_name
                        }
                    ],
                    subject: 'AetherFlow Password Reset Request'
                }
            ],
            from: {
                email: SENDGRID_SENDER_EMAIL,
                name: SENDGRID_SENDER_NAME
            },
            content: [
                {
                    type: 'text/plain',
                    value: `Hello ${first_name},\n\nYou recently requested to reset your password for your AetherFlow account. Please click on the following link within the next hour to reset your password: ${resetLink}\n\nIf you did not request a password reset, please ignore this email.\n\nThank You,\nAetherFlow Team`
                },
                {
                    type: 'text/html',
                    value: `
                    <p>Hello <strong>${first_name}</strong>,</p>
                    <p>You recently requested to reset your password for your AetherFlow account. Please click on the following link within the next hour to reset your password:</p>
                    <p><a href="${resetLink}">Click here to reset your password</a></p>
                    <p>If the link doesn't work, copy and paste this URL into your browser: <code>${resetLink}</code></p>
                    <p>If you did not request a password reset, please ignore this email.</p>
                    <p>Thank You,<br/>AetherFlow Team</p>
                    `
                }
            ]
        };

    if (SENDGRID_API_KEY) {
        try {
            const sendgridResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SENDGRID_API_KEY}`
                },
                body: JSON.stringify(sendgridPayload)
            });

            if (!sendgridResponse.ok) {
                const errorData = await sendgridResponse.json();
                console.error('Failed to send password reset email via SendGrid:', sendgridResponse.status, errorData);
                 // Important: For security, still return a generic success message even if email sending fails.
            }
        } catch (emailError) {
            console.error('Error sending password reset email:', emailError);
            // Important: For security, still return a generic success message even if email sending fails.
        }
    } else {
        console.warn(`SENDGRID_API_KEY is not set. Not sending password reset email.`);
        console.log(`Mock Password Reset: Send this link to ${email}: ${resetLink}`);
    }

    res.status(200).json({ message: 'Password reset link sent if email exists.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.5. Reset Password
app.post('/api/v1/auth/reset_password', async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) {
    return res.status(400).json({ message: 'Token and new password are required.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
  }

  const client = await pool.connect();
  try {
    const decoded = jwt.verify(token, PASSWORD_RESET_SECRET);
    const { user_id } = decoded;
    const hashedPassword = await bcrypt.hash(new_password, 10);
    const now = new Date().toISOString();

    const result = await client.query(
      `UPDATE users SET password_hash = $1, password_reset_token = NULL, updated_at = $2 WHERE id = $3 AND password_reset_token = $4 RETURNING id`,
      [hashedPassword, now, user_id, token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired reset token.' });
    }

    res.status(200).json({ message: 'Password has been reset successfully.' });
  } catch (error) {
    console.error('Reset password error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(400).json({ message: 'Reset token has expired.' });
    }
    res.status(500).json({ message: 'Internal server error during password reset.' });
  } finally {
    client.release();
  }
});

// II.B.6. Get Current User Profile
app.get('/api/v1/users/me', authenticate_jwt, async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, email, first_name, last_name, profile_picture_url FROM users WHERE id = $1`,
      [req.user_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.7. Update User Profile
app.put('/api/v1/users/me', authenticate_jwt, async (req, res) => {
  const { first_name, last_name, profile_picture_url } = req.body;
  const user_id = req.user_id;
  const now = new Date().toISOString();

  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE users SET first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name), profile_picture_url = COALESCE($3, profile_picture_url), updated_at = $4 WHERE id = $5 RETURNING id, email, first_name, last_name, profile_picture_url`,
      [first_name, last_name, profile_picture_url, now, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.8. Change User Password
app.put('/api/v1/users/me/password', authenticate_jwt, async (req, res) => {
  const { current_password, new_password } = req.body;
  const user_id = req.user_id;

  if (!current_password || !new_password) {
    return res.status(400).json({ message: 'Current password and new password are required.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ message: 'New password must be at least 8 characters long.' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT password_hash FROM users WHERE id = $1`, [user_id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(current_password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);
    const now = new Date().toISOString();

    await client.query(
      `UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3`,
      [hashedPassword, now, user_id]
    );
    res.status(200).json({ message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.9. Upload Profile Picture
app.post('/api/v1/files/upload_profile_picture', authenticate_jwt, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }
  // Multer saves the file, and we return the URL where it can be accessed
  const file_url = `/storage/${req.file.filename}`; // This assumes /storage is mapped publicly
  res.status(200).json({ file_url });
});

// II.B.10. Create Project
app.post('/api/v1/projects', authenticate_jwt, async (req, res) => {
  const { project_name, project_key, description, project_lead_user_id } = req.body;
  const current_user_id = req.user_id;
  const now = new Date().toISOString();

  if (!project_name || !project_key) {
    return res.status(400).json({ message: 'Project name and key are required.' });
  }
  if (!/^[A-Z0-9]+$/.test(project_key) || project_key.length > 10) {
    return res.status(400).json({ message: 'Project key must be uppercase alphanumeric and max 10 characters.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check for unique project_name and project_key
    const existingProject = await client.query(
      `SELECT id FROM projects WHERE project_name = $1 OR project_key = $2`,
      [project_name, project_key]
    );
    if (existingProject.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Project name or key already exists.' });
    }

    const lead_user = project_lead_user_id || current_user_id;

    // Verify lead user exists
    const userExists = await client.query(`SELECT id FROM users WHERE id = $1`, [lead_user]);
    if (userExists.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Specified project lead user does not exist.' });
    }

    const project_id = get_next_id('proj');
    await client.query(
      `INSERT INTO projects (id, project_name, project_key, description, project_lead_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [project_id, project_name, project_key, description, lead_user, now, now]
    );

    const project_member_id = get_next_id('pm');
    await client.query(
      `INSERT INTO project_members (id, project_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [project_member_id, project_id, current_user_id, 'Admin', now, now]
    );

    await client.query('COMMIT');

    const projectLeadDetails = await map_user_min_details_from_db(client, lead_user);

    res.status(201).json({
      id: project_id,
      project_name,
      project_key,
      description,
      project_lead: projectLeadDetails,
      created_at: now,
      updated_at: now,
      current_user_role: 'Admin'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create project error:', error);
    res.status(500).json({ message: 'Internal server error during project creation.' });
  } finally {
    client.release();
  }
});

// II.B.11. Get All Projects
app.get('/api/v1/projects', authenticate_jwt, async (req, res) => {
  const user_id = req.user_id;
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT p.id, p.project_name, p.project_key, p.description, p.project_lead_user_id, p.created_at, p.updated_at,
              u.first_name, u.last_name, u.profile_picture_url, pm.role as user_role
       FROM projects p
       JOIN project_members pm ON p.id = pm.project_id
       JOIN users u ON p.project_lead_user_id = u.id
       WHERE pm.user_id = $1`,
      [user_id]
    );

    const projects = result.rows.map(row => ({
      id: row.id,
      project_name: row.project_name,
      project_key: row.project_key,
      description: row.description,
      project_lead: map_user_min_details(row), // Using row directly as it contains lead user details
      created_at: row.created_at,
      updated_at: row.updated_at,
      user_role: row.user_role
    }));

    res.status(200).json(projects);
  } catch (error) {
    console.error('Get all projects error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.12. Get Project Details
app.get('/api/v1/projects/:project_id', authenticate_jwt, async (req, res) => {
  const { project_id } = req.params;
  const user_id = req.user_id;
  const client = await pool.connect();

  try {
    const role = await check_project_membership(project_id, user_id);
    if (!role) {
      return res.status(403).json({ message: 'Forbidden: User is not a member of this project.' });
    }

    const result = await client.query(
      `SELECT p.id, p.project_name, p.project_key, p.description, p.project_lead_user_id, p.created_at, p.updated_at,
              u.first_name, u.last_name, u.profile_picture_url
       FROM projects p
       JOIN users u ON p.project_lead_user_id = u.id
       WHERE p.id = $1`,
      [project_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Project not found.' });
    }

    const row = result.rows[0];
    res.status(200).json({
      id: row.id,
      project_name: row.project_name,
      project_key: row.project_key,
      description: row.description,
      project_lead: map_user_min_details(row),
      created_at: row.created_at,
      updated_at: row.updated_at,
      current_user_role: role
    });
  } catch (error) {
    console.error('Get project details error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.13. Update Project Details
app.put('/api/v1/projects/:project_id', authenticate_jwt, check_project_admin, async (req, res) => {
  const { project_id } = req.params;
  const { project_name, project_key, description, project_lead_user_id } = req.body;
  const now = new Date().toISOString();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check for unique project_name or project_key conflicts
    if (project_name || project_key) {
      const conflictCheck = await client.query(
        `SELECT id FROM projects WHERE (project_name = $1 OR project_key = $2) AND id != $3`,
        [project_name, project_key, project_id]
      );
      if (conflictCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Project name or key already exists for another project.' });
      }
    }
    if (project_key && (!/^[A-Z0-9]+$/.test(project_key) || project_key.length > 10)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Project key must be uppercase alphanumeric and max 10 characters.' });
    }

    let lead_user_id_to_set = project_lead_user_id;
    if (project_lead_user_id) {
      const userExists = await client.query(`SELECT id FROM users WHERE id = $1`, [project_lead_user_id]);
      if (userExists.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Specified project lead user does not exist.' });
      }
    } else {
      // Get current project lead if not provided in request (needed for COALESCE fallback)
      const currentLead = await client.query(`SELECT project_lead_user_id FROM projects WHERE id = $1`, [project_id]);
      if (currentLead.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Project not found.' });
      }
      lead_user_id_to_set = currentLead.rows[0].project_lead_user_id; // Will be used in query as fallback
    }

    const result = await client.query(
      `UPDATE projects SET
         project_name = COALESCE($1, project_name),
         project_key = COALESCE($2, project_key),
         description = COALESCE($3, description),
         project_lead_user_id = COALESCE($4, project_lead_user_id),
         updated_at = $5
       WHERE id = $6
       RETURNING id, project_name, project_key, description, project_lead_user_id, created_at, updated_at`,
      [project_name, project_key, description, lead_user_id_to_set, now, project_id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Project not found or no changes made.' });
    }

    await client.query('COMMIT');

    const updatedProject = result.rows[0];
    const projectLeadDetails = await map_user_min_details_from_db(client, updatedProject.project_lead_user_id);

    res.status(200).json({
      ...updatedProject,
      project_lead: projectLeadDetails
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update project error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.14. Delete Project
app.delete('/api/v1/projects/:project_id', authenticate_jwt, check_project_admin, async (req, res) => {
  const { project_id } = req.params;
  const { confirm_name } = req.query; // Explicit confirmation

  const client = await pool.connect();
  try {
    // Get project name for confirmation
    const projectResult = await client.query(`SELECT project_name FROM projects WHERE id = $1`, [project_id]);
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ message: 'Project not found.' });
    }
    if (projectResult.rows[0].project_name !== confirm_name) {
      return res.status(400).json({ message: 'Confirmation name mismatched. Project not deleted.' });
    }

    const deleteResult = await client.query(`DELETE FROM projects WHERE id = $1`, [project_id]);

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ message: 'Project not found or already deleted.' });
    }
    res.status(204).send(); // No Content
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.15. Get Project Members
app.get('/api/v1/projects/:project_id/members', authenticate_jwt, check_project_member, async (req, res) => {
  const { project_id } = req.params;
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT pm.id, pm.project_id, pm.user_id, pm.role, pm.created_at, pm.updated_at,
              u.email, u.first_name, u.last_name, u.profile_picture_url
       FROM project_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = $1`,
      [project_id]
    );

    const members = result.rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      project_id: row.project_id,
      role: row.role,
      created_at: row.created_at,
      updated_at: row.updated_at,
      user_details: {
        id: row.user_id,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
        profile_picture_url: row.profile_picture_url
      }
    }));
    res.status(200).json(members);
  } catch (error) {
    console.error('Get project members error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.16. Add Project Member
app.post('/api/v1/projects/:project_id/members', authenticate_jwt, check_project_admin, async (req, res) => {
  const { project_id } = req.params;
  const { user_id } = req.body;
  const now = new Date().toISOString();
  const client = await pool.connect();

  try {
    // Check if project exists
    const projectExists = await client.query(`SELECT id FROM projects WHERE id = $1`, [project_id]);
    if (projectExists.rows.length === 0) {
      return res.status(404).json({ message: 'Project not found.' });
    }

    // Check if user exists
    const userExists = await client.query(`SELECT id, email, first_name, last_name, profile_picture_url FROM users WHERE id = $1`, [user_id]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }
    const userDetails = userExists.rows[0];

    // Check if user is already a member
    const existingMember = await client.query(
      `SELECT id FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [project_id, user_id]
    );
    if (existingMember.rows.length > 0) {
      return res.status(400).json({ message: 'User is already a member of this project.' });
    }

    const member_id = get_next_id('pm');
    await client.query(
      `INSERT INTO project_members (id, project_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [member_id, project_id, user_id, 'Member', now, now]
    );

    res.status(201).json({
      id: member_id,
      user_id: user_id,
      project_id: project_id,
      role: 'Member',
      created_at: now,
      updated_at: now,
      user_details: userDetails
    });
  } catch (error) {
    console.error('Add project member error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.17. Update Project Member Role
app.put('/api/v1/projects/:project_id/members/:member_id', authenticate_jwt, check_project_admin, async (req, res) => {
  const { project_id, member_id } = req.params;
  const { role } = req.body; // 'Admin' or 'Member'
  const now = new Date().toISOString();
  const client = await pool.connect();

  if (!role || !['Admin', 'Member'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role specified. Must be "Admin" or "Member".' });
  }

  try {
    const result = await client.query(
      `UPDATE project_members SET role = $1, updated_at = $2 WHERE id = $3 AND project_id = $4 RETURNING user_id, created_at, updated_at`,
      [role, now, member_id, project_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Project member not found in this project.' });
    }

    const updatedMember = result.rows[0];
    const userDetails = await map_user_min_details_from_db(client, updatedMember.user_id);

    res.status(200).json({
      id: member_id,
      user_id: updatedMember.user_id,
      project_id: project_id,
      role: role,
      created_at: updatedMember.created_at,
      updated_at: now,
      user_details: userDetails
    });
  } catch (error) {
    console.error('Update project member role error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.18. Remove Project Member
app.delete('/api/v1/projects/:project_id/members/:member_id', authenticate_jwt, check_project_admin, async (req, res) => {
  const { project_id, member_id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Prevent deleting the last Admin of a project, or Project Lead if they are also the member being deleted
    const projectInfo = await client.query(`SELECT project_lead_user_id FROM projects WHERE id = $1`, [project_id]);
    if (projectInfo.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Project not found.' });
    }
    const project_lead_user_id = projectInfo.rows[0].project_lead_user_id;

    const memberToDelete = await client.query(`SELECT user_id, role FROM project_members WHERE id = $1 AND project_id = $2`, [member_id, project_id]);
    if (memberToDelete.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Project member not found in this project.' });
    }
    const { user_id: deleted_user_id, role: deleted_user_role } = memberToDelete.rows[0];

    // Check if trying to delete the sole Admin
    if (deleted_user_role === 'Admin') {
      const adminCount = await client.query(`SELECT COUNT(*) FROM project_members WHERE project_id = $1 AND role = 'Admin'`, [project_id]);
      if (parseInt(adminCount.rows[0].count) === 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Cannot remove the sole Project Admin.' });
      }
    }

    // If the member being deleted is the Project Lead, re-assign Project Lead (or prevent deletion)
    if (deleted_user_id === project_lead_user_id) {
        // Find another Admin to be the lead, or pick any other member if no other admin exists
        const otherAdmins = await client.query(`SELECT user_id FROM project_members WHERE project_id = $1 AND role = 'Admin' AND user_id != $2 LIMIT 1`, [project_id, deleted_user_id]);
        if (otherAdmins.rows.length > 0) {
            await client.query(`UPDATE projects SET project_lead_user_id = $1 WHERE id = $2`, [otherAdmins.rows[0].user_id, project_id]);
        } else {
            // No other admin, find any other member just to have a lead to avoid ON DELETE RESTRICT from users table if that was the last user of project.
            const otherMember = await client.query(`SELECT user_id FROM project_members WHERE project_id = $1 AND user_id != $2 LIMIT 1`, [project_id, deleted_user_id]);
            if (otherMember.rows.length > 0) {
              await client.query(`UPDATE projects SET project_lead_user_id = $1 WHERE id = $2`, [otherMember.rows[0].user_id, project_id]);
            } else {
                // No other members left, this would leave the project without a lead, which is foreign key restricted.
                // This scenario means the project would also be implicitly deleted, but that's handled by project delete endpoint.
                // For a member removal, if they are the last lead and last member, it's problematic if the project must remain.
                // Assuming project must always have a lead and at least one member.
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'Cannot remove Project Lead - no other members to assign as lead.' });
            }
        }
    }

    // Set assignee_user_id and reporter_user_id on issues to null for issues within this project.
    // NOTE: The `projects.project_lead_user_id` has `ON DELETE RESTRICT` on `users` table. This means a user cannot be deleted if they are a lead.
    // Here we are deleting from `project_members`, not `users` table directly, so this logic handles the `issues` table foreign keys.
    await client.query(`UPDATE issues SET assignee_user_id = NULL WHERE project_id = $1 AND assignee_user_id = $2`, [project_id, deleted_user_id]);
    await client.query(`UPDATE issues SET reporter_user_id = NULL WHERE project_id = $1 AND reporter_user_id = $2`, [project_id, deleted_user_id]);


    const deleteResult = await client.query(`DELETE FROM project_members WHERE id = $1`, [member_id]);

    if (deleteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Project member not found or already removed.' });
    }

    await client.query('COMMIT');
    res.status(204).send(); // No Content
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Remove project member error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});


// II.B.19. Create Issue
app.post('/api/v1/projects/:project_id/issues', authenticate_jwt, check_project_member, async (req, res) => {
  const { project_id } = req.params;
  const { issue_type, summary, description, assignee_user_id, priority, due_date, labels, attachments, sub_tasks } = req.body;
  const reporter_user_id = req.user_id; // Current authenticated user is reporter
  const now = new Date().toISOString();
  const client = await pool.connect();

  if (!issue_type || !summary || !priority) {
    return res.status(400).json({ message: 'Issue type, summary, and priority are required.' });
  }
  if (!['Task', 'Bug', 'Story'].includes(issue_type)) {
    return res.status(400).json({ message: `Invalid issue type: ${issue_type}.` });
  }
  if (!['Highest', 'High', 'Medium', 'Low', 'Lowest'].includes(priority)) {
    return res.status(400).json({ message: `Invalid priority: ${priority}.` });
  }

  try {
    await client.query('BEGIN');

    // Get project_key for issue_key derivation
    const project_result = await client.query(`SELECT project_key, project_name FROM projects WHERE id = $1`, [project_id]);
    if (project_result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Project not found.' });
    }
    const project_key = project_result.rows[0].project_key;
    const project_name = project_result.rows[0].project_name;

    // Determine the next rank for the issue logic (simply incrementing max_rank in project)
    const max_rank_result = await client.query(
      `SELECT MAX(rank) FROM issues WHERE project_id = $1`,
      [project_id]
    );
    const new_rank = (max_rank_result.rows[0].max || 0) + 1;

    // Check if assignee exists and is a member of the project
    let validated_assignee_user_id = assignee_user_id || null;
    if (validated_assignee_user_id) {
      const assignee_member_check = await client.query(`SELECT user_id FROM project_members WHERE project_id = $1 AND user_id = $2`, [project_id, validated_assignee_user_id]);
      if (assignee_member_check.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Assignee is not a member of this project or does not exist.' });
      }
    }

    const issue_id = get_next_id('issue');
    await client.query(
      `INSERT INTO issues (id, project_id, issue_type, summary, description, assignee_user_id, reporter_user_id, priority, status, due_date, rank, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [issue_id, project_id, issue_type, summary, description, validated_assignee_user_id, reporter_user_id, priority, 'To Do', due_date, new_rank, now, now]
    );

    // Initial response object construction
    const created_issue_response = {
      id: issue_id,
      project_id: project_id,
      project_summary: {id: project_id, project_name, project_key},
      issue_type: issue_type,
      issue_key: derive_issue_key(project_key, issue_id),
      summary: summary,
      description: description,
      assignee: validated_assignee_user_id ? await map_user_min_details_from_db(client, validated_assignee_user_id) : null,
      reporter: await map_user_min_details_from_db(client, reporter_user_id),
      priority: priority,
      status: 'To Do',
      due_date: due_date,
      parent_issue_id: null, // This is a top-level issue
      rank: new_rank,
      created_at: now,
      updated_at: now,
      labels: [],
      attachments: [],
      sub_tasks: [],
      linked_issues: [],
      activity_log: []
    };

    // Handle Labels
    if (labels && labels.length > 0) {
      for (const label_name of labels) {
        let label_result = await client.query(`SELECT id FROM labels WHERE label_name = $1`, [label_name]);
        let label_id;
        if (label_result.rows.length === 0) {
          label_id = get_next_id('label');
          await client.query(
            `INSERT INTO labels (id, label_name, created_at, updated_at) VALUES ($1, $2, $3, $4)`,
            [label_id, label_name, now, now]
          );
        } else {
          label_id = label_result.rows[0].id;
        }
        const issue_label_id = get_next_id('isl');
        await client.query(
          `INSERT INTO issue_labels (id, issue_id, label_id, created_at) VALUES ($1, $2, $3, $4)`,
          [issue_label_id, issue_id, label_id, now]
        );
        created_issue_response.labels.push({ id: label_id, label_name: label_name });
      }
    }

    // Handle Attachments (assuming attachments array contains pre-uploaded file details)
    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        const attachment_id = get_next_id('att');
        await client.query(
          `INSERT INTO attachments (id, issue_id, file_name, file_url, mime_type, file_size, uploaded_by_user_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [attachment_id, issue_id, attachment.file_name, attachment.file_url, attachment.mime_type, attachment.file_size, reporter_user_id, now]
        );
        created_issue_response.attachments.push({
          id: attachment_id, issue_id, file_name: attachment.file_name, file_url: attachment.file_url,
          mime_type: attachment.mime_type, file_size: attachment.file_size, uploaded_by: await map_user_min_details_from_db(client, reporter_user_id), created_at: now
        });
      }
    }

    // Handle Sub-tasks
    if (sub_tasks && sub_tasks.length > 0) {
      for (const sub_task_details of sub_tasks) {
        const sub_task_id = get_next_id('issue');
        let sub_task_assignee_id = sub_task_details.assignee_user_id || null;
        if (sub_task_assignee_id) {
          const subTaskAssigneeCheck = await client.query(`SELECT user_id FROM project_members WHERE project_id = $1 AND user_id = $2`, [project_id, sub_task_assignee_id]);
          if (subTaskAssigneeCheck.rows.length === 0) {
             console.warn(`Sub-task assignee ${sub_task_assignee_id} is not a member of project ${project_id}. Sub-task will be unassigned.`);
             sub_task_assignee_id = null;
          }
        }
        await client.query(
          `INSERT INTO issues (id, project_id, issue_type, summary, description, assignee_user_id, reporter_user_id, priority, status, due_date, parent_issue_id, rank, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [sub_task_id, project_id, 'Task', sub_task_details.summary, null, sub_task_assignee_id, reporter_user_id, 'Medium', 'To Do', null, issue_id, new_rank + 1, now, now]
        );
        created_issue_response.sub_tasks.push({
          id: sub_task_id,
          summary: sub_task_details.summary,
          assignee: sub_task_assignee_id ? await map_user_min_details_from_db(client, sub_task_assignee_id) : null,
          status: 'To Do',
          issue_key: derive_issue_key(project_key, sub_task_id) // Add issue_key for sub-tasks
        });
        await create_activity_and_notify(client, issue_id, reporter_user_id, 'subtask_created',
          { field_name: 'sub_task', new_value: sub_task_details.summary, project_key }); // Log subtask creation for parent issue
      }
    }

    // Log issue creation activity and trigger notifications
    await create_activity_and_notify(client, issue_id, reporter_user_id, 'issue_created', {
      issue_type, project_key, assignee_user_id: validated_assignee_user_id, reporter_user_id
    });

    await client.query('COMMIT');

    res.status(201).json(created_issue_response);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create issue error:', error);
    res.status(500).json({ message: 'Internal server error during issue creation.' });
  } finally {
    client.release();
  }
});


// II.B.20. Get Issue Details
app.get('/api/v1/issues/:issue_id', authenticate_jwt, check_issue_project_member, async (req, res) => {
  const { issue_id } = req.params;
  const client = await pool.connect();
  try {
    const issueResult = await client.query(`
      SELECT
        i.id, i.project_id, i.issue_type, i.summary, i.description, i.assignee_user_id, i.reporter_user_id,
        i.priority, i.status, i.due_date, i.parent_issue_id, i.rank, i.created_at, i.updated_at,
        p.project_name, p.project_key
      FROM issues i
      JOIN projects p ON i.project_id = p.id
      WHERE i.id = $1
    `, [issue_id]);

    if (issueResult.rows.length === 0) {
      return res.status(404).json({ message: 'Issue not found.' });
    }

    const issue = issueResult.rows[0];
    const project_summary = map_project_summary(issue);
    issue.issue_key = derive_issue_key(issue.project_key, issue.id);

    // Fetch related data in parallel
    const [
      assignee_user_details,
      reporter_user_details,
      labels_result,
      attachments_result,
      sub_tasks_result,
      linked_issues_result,
      activity_log_result
    ] = await Promise.all([
      issue.assignee_user_id ? map_user_min_details_from_db(client, issue.assignee_user_id) : Promise.resolve(null),
      map_user_min_details_from_db(client, issue.reporter_user_id),
      client.query(`SELECT l.id, l.label_name FROM labels l JOIN issue_labels il ON l.id = il.label_id WHERE il.issue_id = $1`, [issue_id]),
      client.query(`SELECT a.id, a.issue_id, a.file_name, a.file_url, a.mime_type, a.file_size, a.uploaded_by_user_id, a.created_at, u.first_name, u.last_name, u.profile_picture_url
                    FROM attachments a JOIN users u ON a.uploaded_by_user_id = u.id WHERE a.issue_id = $1`, [issue_id]),
      client.query(`SELECT id, summary, assignee_user_id, status FROM issues WHERE parent_issue_id = $1`, [issue_id]),
      client.query(`SELECT il.target_issue_id, i.summary, p.project_key, il.link_type FROM issue_links il JOIN issues i ON il.target_issue_id = i.id JOIN projects p ON i.project_id = p.id WHERE il.source_issue_id = $1`, [issue_id]),
      client.query(`SELECT * FROM activity_logs WHERE issue_id = $1 ORDER BY created_at ASC`, [issue_id])
    ]);

    const labels = labels_result.rows.map(row => ({ id: row.id, label_name: row.label_name }));
    const attachments = attachments_result.rows.map(row => ({
      id: row.id,
      issue_id: row.issue_id,
      file_name: row.file_name,
      file_url: row.file_url,
      mime_type: row.mime_type,
      file_size: row.file_size,
      uploaded_by: map_user_min_details(row), // Using row for user details from join already
      created_at: row.created_at
    }));
    const sub_tasks = await Promise.all(sub_tasks_result.rows.map(async row => ({
      id: row.id,
      summary: row.summary,
      assignee: row.assignee_user_id ? await map_user_min_details_from_db(client, row.assignee_user_id) : null,
      status: row.status,
      issue_key: derive_issue_key(issue.project_key, row.id)
    })));
    const linked_issues = linked_issues_result.rows.map(row => ({
      id: row.target_issue_id,
      issue_key: derive_issue_key(row.project_key, row.target_issue_id), // Ensure linked issue has full key
      summary: row.summary,
      project_key: row.project_key,
      link_type: row.link_type
    }));
    const activity_log = await Promise.all(activity_log_result.rows.map(row => map_activity_log(client, row)));


    res.status(200).json({
      id: issue.id,
      project_id: issue.project_id,
      project_summary: project_summary,
      issue_type: issue.issue_type,
      issue_key: issue.issue_key,
      summary: issue.summary,
      description: issue.description,
      assignee: assignee_user_details,
      reporter: reporter_user_details,
      priority: issue.priority,
      status: issue.status,
      due_date: issue.due_date,
      parent_issue_id: issue.parent_issue_id,
      rank: issue.rank,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      labels,
      attachments,
      sub_tasks,
      linked_issues,
      activity_log
    });
  } catch (error) {
    console.error('Get issue details error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.21. Update Issue
app.put('/api/v1/issues/:issue_id', authenticate_jwt, check_issue_project_member, async (req, res) => {
  const { issue_id } = req.params;
  const { summary, description, assignee_user_id, priority, due_date, labels, attachments } = req.body;
  const current_user_id = req.user_id;
  const now = new Date().toISOString();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const issueRes = await client.query(`SELECT project_id, reporter_user_id, assignee_user_id FROM issues WHERE id = $1`, [issue_id]);
    if (issueRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Issue not found.' });
    }
    const { project_id, reporter_user_id, assignee_user_id: old_assignee_user_id } = issueRes.rows[0];

    const userRole = await check_project_membership(project_id, current_user_id);
    // Allow edit if Project Admin, or if Project Member AND is reporter/assignee
    if (userRole !== 'Admin' && current_user_id !== reporter_user_id && current_user_id !== old_assignee_user_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Forbidden: User lacks permission to edit this issue.' });
    }

    if (assignee_user_id !== undefined) { // If assignee_user_id is provided, validate it
      if (assignee_user_id !== null) { // If not setting to null (unassigning)
        const assignee_member_check = await client.query(`SELECT user_id FROM project_members WHERE project_id = $1 AND user_id = $2`, [project_id, assignee_user_id]);
        if (assignee_member_check.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'Assignee is not a member of this project or does not exist.' });
        }
      }
    }

    const updates = [];
    const values = [now, issue_id]; // current_timestamp, issue_id
    let paramIndex = 3; // Index for new parameters

    const oldIssueData = (await client.query(`SELECT summary, description, assignee_user_id, priority, due_date FROM issues WHERE id = $1`, [issue_id])).rows[0];
    const current_project_key = (await client.query(`SELECT project_key FROM projects WHERE id = $1`, [project_id])).rows[0].project_key;

    if (summary !== undefined && summary !== oldIssueData.summary) { updates.push(`summary = $${paramIndex++}`); values.push(summary); await create_activity_and_notify(client, issue_id, current_user_id, 'summary_updated', {field_name: 'summary', old_value: oldIssueData.summary, new_value: summary, project_key: current_project_key}); }
    if (description !== undefined && description !== oldIssueData.description) { updates.push(`description = $${paramIndex++}`); values.push(description); await create_activity_and_notify(client, issue_id, current_user_id, 'description_updated', {field_name: 'description', old_value: oldIssueData.description, new_value: description, project_key: current_project_key}); }
    if (assignee_user_id !== undefined && assignee_user_id !== oldIssueData.assignee_user_id) { updates.push(`assignee_user_id = $${paramIndex++}`); values.push(assignee_user_id); await create_activity_and_notify(client, issue_id, current_user_id, 'assignee_changed', {field_name: 'assignee', old_value: oldIssueData.assignee_user_id, new_value: assignee_user_id, project_key: current_project_key, assignee_user_id: assignee_user_id}); }
    if (priority !== undefined && priority !== oldIssueData.priority) { updates.push(`priority = $${paramIndex++}`); values.push(priority); await create_activity_and_notify(client, issue_id, current_user_id, 'priority_changed', {field_name: 'priority', old_value: oldIssueData.priority, new_value: priority, project_key: current_project_key}); }
    if (due_date !== undefined && due_date !== oldIssueData.due_date) { updates.push(`due_date = $${paramIndex++}`); values.push(due_date); await create_activity_and_notify(client, issue_id, current_user_id, 'due_date_changed', {field_name: 'due_date', old_value: oldIssueData.due_date, new_value: due_date, project_key: current_project_key}); }

    if (updates.length > 0) {
      const query = `UPDATE issues SET ${updates.join(', ')}, updated_at = $1 WHERE id = $2 RETURNING *`;
      const updateResult = await client.query(query, values);
      if (updateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Issue not found or no changes made.' });
      }
    }

    // Handle Labels
    if (labels !== undefined) { // If labels array is explicitly provided (even empty)
      const current_labels_res = await client.query(`SELECT l.id, l.label_name FROM labels l JOIN issue_labels il ON l.id = il.label_id WHERE il.issue_id = $1`, [issue_id]);
      const current_label_names = new Set(current_labels_res.rows.map(l => l.label_name));
      const new_label_names = new Set(labels);

      // Labels to add
      for (const label_name of new_label_names) {
        if (!current_label_names.has(label_name)) {
          let label_res = await client.query(`SELECT id FROM labels WHERE label_name = $1`, [label_name]);
          let label_id;
          if (label_res.rows.length === 0) { // Create new global label if it doesn't exist
            label_id = get_next_id('label');
            await client.query(`INSERT INTO labels (id, label_name, created_at, updated_at) VALUES ($1, $2, $3, $4)`, [label_id, label_name, now, now]);
          } else {
            label_id = label_res.rows[0].id;
          }
          const issue_label_id = get_next_id('isl');
          await client.query(`INSERT INTO issue_labels (id, issue_id, label_id, created_at) VALUES ($1, $2, $3, $4)`, [issue_label_id, issue_id, label_id, now]);
          await create_activity_and_notify(client, issue_id, current_user_id, 'label_added', {field_name: 'label', new_value: label_name, project_key: current_project_key});
        }
      }

      // Labels to remove
      for (const current_label_name of current_label_names) {
        if (!new_label_names.has(current_label_name)) {
          const label_to_remove_res = await client.query(`SELECT id FROM labels WHERE label_name = $1`, [current_label_name]);
          if (label_to_remove_res.rows.length > 0) {
            await client.query(`DELETE FROM issue_labels WHERE issue_id = $1 AND label_id = $2`, [issue_id, label_to_remove_res.rows[0].id]);
             await create_activity_and_notify(client, issue_id, current_user_id, 'label_removed', {field_name: 'label', old_value: current_label_name, project_key: current_project_key});
          }
        }
      }
    }

    // Attachments (assuming `attachments` array only contains NEW attachments to add)
    if (attachments && attachments.length > 0) { // Array of new attachments to add
      for (const attachment of attachments) {
        const attachment_id = get_next_id('att');
        await client.query(
          `INSERT INTO attachments (id, issue_id, file_name, file_url, mime_type, file_size, uploaded_by_user_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [attachment_id, issue_id, attachment.file_name, attachment.file_url, attachment.mime_type, attachment.file_size, current_user_id, now]
        );
        await create_activity_and_notify(client, issue_id, current_user_id, 'attachment_added', {field_name: 'attachment', new_value: attachment.file_name, project_key: current_project_key});
      }
    }

    await client.query('COMMIT');

    const updatedIssueResponse = (await client.query(`
      SELECT
        i.id, i.project_id, i.issue_type, i.summary, i.description, i.assignee_user_id, i.reporter_user_id,
        i.priority, i.status, i.due_date, i.parent_issue_id, i.rank, i.created_at, i.updated_at,
        p.project_name, p.project_key
      FROM issues i JOIN projects p ON i.project_id = p.id WHERE i.id = $1
    `, [issue_id])).rows[0];

    const issue_key = derive_issue_key(updatedIssueResponse.project_key, updatedIssueResponse.id);
    const project_summary_obj = map_project_summary(updatedIssueResponse);

    const [
      assignee_user_details,
      reporter_user_details,
      labels_data,
      attachments_data,
      sub_tasks_data,
      linked_issues_data,
      activity_log_data
    ] = await Promise.all([
      updatedIssueResponse.assignee_user_id ? map_user_min_details_from_db(client, updatedIssueResponse.assignee_user_id) : Promise.resolve(null),
      map_user_min_details_from_db(client, updatedIssueResponse.reporter_user_id),
      client.query(`SELECT l.id,l.label_name FROM labels l JOIN issue_labels il ON l.id = il.label_id WHERE il.issue_id = $1`, [issue_id]),
      client.query(`SELECT a.id, a.issue_id, a.file_name, a.file_url, a.mime_type, a.file_size, a.uploaded_by_user_id, a.created_at, u.first_name, u.last_name, u.profile_picture_url FROM attachments a JOIN users u ON a.uploaded_by_user_id = u.id WHERE a.issue_id = $1`, [issue_id]),
      client.query(`SELECT id, summary, assignee_user_id, status FROM issues WHERE parent_issue_id = $1`, [issue_id]),
      client.query(`SELECT il.target_issue_id, i.summary, p.project_key, il.link_type FROM issue_links il JOIN issues i ON il.target_issue_id = i.id JOIN projects p ON i.project_id = p.id WHERE il.source_issue_id = $1`, [issue_id]),
      client.query(`SELECT * FROM activity_logs WHERE issue_id = $1 ORDER BY created_at ASC`, [issue_id])
    ]);

    res.status(200).json({
      ...updatedIssueResponse,
      issue_key,
      project_summary: project_summary_obj,
      assignee: assignee_user_details,
      reporter: reporter_user_details,
      labels: labels_data.rows.map(row => ({ id: row.id, label_name: row.label_name })),
      attachments: attachments_data.rows.map(row => ({id: row.id, issue_id: row.issue_id, file_name: row.file_name, file_url: row.file_url, mime_type: row.mime_type, file_size: row.file_size, uploaded_by: map_user_min_details(row), created_at: row.created_at})),
      sub_tasks: await Promise.all(sub_tasks_data.rows.map(async row => ({id: row.id, summary: row.summary, assignee: row.assignee_user_id ? await map_user_min_details_from_db(client, row.assignee_user_id) : null, status: row.status, issue_key: derive_issue_key(updatedIssueResponse.project_key, row.id)}))),
      linked_issues: linked_issues_data.rows.map(row => ({
          id: row.target_issue_id,
          issue_key: derive_issue_key(row.project_key, row.target_issue_id),
          summary: row.summary,
          project_key: row.project_key,
          link_type: row.link_type
      })),
      activity_log: await Promise.all(activity_log_data.rows.map(row => map_activity_log(client, row))),
    });


  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update issue error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.22. Delete Issue
app.delete('/api/v1/issues/:issue_id', authenticate_jwt, check_issue_project_member, async (req, res) => {
  const { issue_id } = req.params;
  const user_id = req.user_id; // For context and logging
  const client = await pool.connect();

  try {
    const issueRes = await client.query(`SELECT project_id FROM issues WHERE id = $1`, [issue_id]);
    if (issueRes.rows.length === 0) {
      return res.status(404).json({ message: 'Issue not found.' });
    }
    const project_id = issueRes.rows[0].project_id;

    const userRole = await check_project_membership(project_id, user_id);
    if (userRole !== 'Admin') {
      return res.status(403).json({ message: 'Forbidden: Only Project Admins can delete issues.' });
    }

    const deleteResult = await client.query(`DELETE FROM issues WHERE id = $1`, [issue_id]);
    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ message: 'Issue not found or already deleted.' });
    }

    res.status(204).send(); // No Content
  } catch (error) {
    console.error('Delete issue error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.23. Add Comment to Issue
app.post('/api/v1/issues/:issue_id/comments', authenticate_jwt, check_issue_project_member, async (req, res) => {
  const { issue_id } = req.params;
  const { comment_content } = req.body;
  const user_id = req.user_id;
  const now = new Date().toISOString();
  const client = await pool.connect();

  if (!comment_content || comment_content.trim() === '') {
    return res.status(400).json({ message: 'Comment content cannot be empty.' });
  }

  try {
    await client.query('BEGIN');

    const issueRes = await client.query(`SELECT project_id, reporter_user_id, assignee_user_id FROM issues WHERE id = $1`, [issue_id]);
    if (issueRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Issue not found.' });
    }
    const { project_id, reporter_user_id, assignee_user_id } = issueRes.rows[0];
    const project_key_result = await client.query(`SELECT project_key FROM projects WHERE id = $1`, [project_id]);
    const project_key = project_key_result.rows[0]?.project_key;


    const comment_id = get_next_id('comm');
    await client.query(
      `INSERT INTO comments (id, issue_id, user_id, comment_content, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [comment_id, issue_id, user_id, comment_content, now, now]
    );

    // Parse @mentions
    const mentioned_user_ids = [];
    const mentionRegex = /@([a-zA-Z0-9_\u00C0-\u017F]+(?:\s[a-zA-Z0-9_\u00C0-\u017F]+)*)/g; // Matches @username (supports spaces in names)
    let match;
    while ((match = mentionRegex.exec(comment_content)) !== null) {
        const full_name_or_alias = match[1].trim();
        // Try to match by full name (first_name + last_name) or email-like alias. For a robust system, an `@user_id` syntax is better.
        // For simplicity and matching names:
        const mentionedUserResult = await client.query(`
            SELECT id FROM users
            WHERE (first_name || ' ' || last_name) ILIKE $1
               OR (first_name ILIKE $2 AND last_name ILIKE $3)
               OR email ILIKE $4
        `, [`%${full_name_or_alias}%`, `%${full_name_or_alias.split(' ')[0]}%`, `%${full_name_or_alias.split(' ').slice(1).join(' ')}%`, `${full_name_or_alias}@%`]);

        if (mentionedUserResult.rows.length > 0) {
            const mentionedUserId = mentionedUserResult.rows[0].id;
            // Only add if not current user and not already in set (handle multiple mentions of same person)
            if (mentionedUserId !== user_id && !mentioned_user_ids.includes(mentionedUserId)) {
                mentioned_user_ids.push(mentionedUserId);
            }
        }
    }


    await create_activity_and_notify(client, issue_id, user_id, 'comment_added',
      { comment_id, project_key, reporter_user_id, assignee_user_id, mentioned_users: mentioned_user_ids });

    await client.query('COMMIT');

    const user_details = await map_user_min_details_from_db(client, user_id);

    res.status(201).json({
      id: comment_id,
      issue_id: issue_id,
      user: user_details,
      comment_content: comment_content,
      created_at: now,
      updated_at: now,
      deleted_at: null
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Add comment error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.24. Edit Comment
app.put('/api/v1/comments/:comment_id', authenticate_jwt, async (req, res) => {
  const { comment_id } = req.params;
  const { comment_content } = req.body;
  const user_id = req.user_id;
  const now = new Date();
  const client = await pool.connect();

  if (!comment_content || comment_content.trim() === '') {
    return res.status(400).json({ message: 'Comment content cannot be empty.' });
  }

  try {
    await client.query('BEGIN');

    const commentResult = await client.query(`SELECT issue_id, user_id, created_at, comment_content FROM comments WHERE id = $1 AND deleted_at IS NULL`, [comment_id]);
    if (commentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Comment not found or already deleted.' });
    }

    const { issue_id, user_id: comment_author_id, created_at: comment_created_at, comment_content: old_comment_content } = commentResult.rows[0];

    // Check if authenticated user is the author
    if (user_id !== comment_author_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Forbidden: You can only edit your own comments.' });
    }

    // Check if within 5-minute edit window
    const commentAgeMs = now.getTime() - new Date(comment_created_at).getTime();
    const fiveMinutesMs = 5 * 60 * 1000; // 5 minutes
    if (commentAgeMs > fiveMinutesMs) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Edit window expired (5 minutes).' });
    }

    const updateResult = await client.query(
      `UPDATE comments SET comment_content = $1, updated_at = $2 WHERE id = $3 RETURNING *`,
      [comment_content, now.toISOString(), comment_id]
    );

    const updated_comment = updateResult.rows[0];

    // Log activity
    const project_res = await client.query(`SELECT project_key FROM projects p JOIN issues i ON p.id = i.project_id WHERE i.id = $1`, [issue_id]);
    const project_key = project_res.rows[0]?.project_key || '';

    await create_activity_and_notify(client, issue_id, user_id, 'comment_edited', {
      field_name: 'comment_content',
      old_value: old_comment_content,
      new_value: comment_content,
      comment_id, project_key
    });

    await client.query('COMMIT');

    const user_details = await map_user_min_details_from_db(client, user_id);
    res.status(200).json({
      id: updated_comment.id,
      issue_id: updated_comment.issue_id,
      user: user_details,
      comment_content: updated_comment.comment_content,
      created_at: updated_comment.created_at,
      updated_at: updated_comment.updated_at,
      deleted_at: updated_comment.deleted_at
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Edit comment error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.25. Delete Comment
app.delete('/api/v1/comments/:comment_id', authenticate_jwt, async (req, res) => {
  const { comment_id } = req.params;
  const user_id = req.user_id;
  const now = new Date().toISOString();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const commentResult = await client.query(`SELECT issue_id, user_id FROM comments WHERE id = $1 AND deleted_at IS NULL`, [comment_id]);
    if (commentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Comment not found or already deleted.' });
    }
    const { issue_id, user_id: comment_author_id } = commentResult.rows[0];

    const issueRes = await client.query(`SELECT project_id FROM issues WHERE id = $1`, [issue_id]);
    if (issueRes.rows.length === 0) { /* This shouldn't happen if comment exists */ await client.query('ROLLBACK'); return res.status(500).json({ message: 'Related issue not found.' });}
    const project_id = issueRes.rows[0].project_id;
    const project_key = (await client.query(`SELECT project_key FROM projects WHERE id = $1`, [project_id])).rows[0].project_key;

    const userRole = await check_project_membership(project_id, user_id);

    // Allow deletion if user is author OR Project Admin
    if (user_id !== comment_author_id && userRole !== 'Admin') {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Forbidden: You can only delete your own comments, or be a Project Admin to delete any comment.' });
    }

    const deleteResult = await client.query(
      `UPDATE comments SET deleted_at = $1, updated_at = $2 WHERE id = $3 RETURNING *`,
      [now, now, comment_id]
    );

    if (deleteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Comment not found or already deleted.' });
    }

    // Log activity
    await create_activity_and_notify(client, issue_id, user_id, 'comment_deleted', {
      comment_id: comment_id, project_key
    });

    await client.query('COMMIT');
    res.status(204).send(); // No Content
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete comment error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.26. Upload Issue Attachment
app.post('/api/v1/issues/:issue_id/attachments', authenticate_jwt, check_issue_project_member, upload.single('file'), async (req, res) => {
  const { issue_id } = req.params;
  const user_id = req.user_id;
  const now = new Date().toISOString();
  const client = await pool.connect();

  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  const { originalname, filename, mimetype, size } = req.file;

  try {
    await client.query('BEGIN');

    const issueRes = await client.query(`SELECT project_id FROM issues WHERE id = $1`, [issue_id]);
    const project_id = issueRes.rows[0].project_id;
    const project_key = (await client.query(`SELECT project_key FROM projects WHERE id = $1`, [project_id])).rows[0].project_key;

    const attachment_id = get_next_id('att');
    const file_url = `/storage/${filename}`; // Public URL for the file

    await client.query(
      `INSERT INTO attachments (id, issue_id, file_name, file_url, mime_type, file_size, uploaded_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [attachment_id, issue_id, originalname, file_url, mimetype, size, user_id, now]
    );

    await create_activity_and_notify(client, issue_id, user_id, 'attachment_added', {
      field_name: 'attachment',
      new_value: originalname, project_key
    });

    await client.query('COMMIT');

    const uploaded_by_user_details = await map_user_min_details_from_db(client, user_id);

    res.status(201).json({
      id: attachment_id,
      issue_id: issue_id,
      file_name: originalname,
      file_url: file_url,
      mime_type: mimetype,
      file_size: size,
      uploaded_by: uploaded_by_user_details,
      created_at: now
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Upload attachment error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.27. Delete Issue Attachment
app.delete('/api/v1/attachments/:attachment_id', authenticate_jwt, async (req, res) => {
  const { attachment_id } = req.params;
  const user_id = req.user_id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const attachmentResult = await client.query(
      `SELECT a.issue_id, a.uploaded_by_user_id, a.file_name, i.project_id
       FROM attachments a
       JOIN issues i ON a.issue_id = i.id
       WHERE a.id = $1`,
      [attachment_id]
    );
    if (attachmentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Attachment not found.' });
    }

    const { issue_id, uploaded_by_user_id, file_name, project_id } = attachmentResult.rows[0];
    const project_key = (await client.query(`SELECT project_key FROM projects WHERE id = $1`, [project_id])).rows[0].project_key;

    const userRole = await check_project_membership(project_id, user_id);
    // Allow deletion if user is uploader OR Project Admin
    if (user_id !== uploaded_by_user_id && userRole !== 'Admin') {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Forbidden: You can only delete your own attachments, or be a Project Admin.' });
    }

    const deleteResult = await client.query(`DELETE FROM attachments WHERE id = $1`, [attachment_id]);
    if (deleteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Attachment not found or already deleted.' });
    }

    // Delete file from local storage
    const file_path = path.join(STORAGE_DIR, file_name.split('-').slice(0, -1).join('-') + path.extname(file_name)); // Reconstruct filename to delete from storage. Needs review.
    // The filename stores unique suffix right from multer. filename in DB like file.fieldname-uniqueId.ext
    // Path should be path.join(STORAGE_DIR, originalname_from_db) but we store filename from multer. Corrected:
    const file_to_delete_from_disk = path.join(STORAGE_DIR, file_name); // use file_name from attachmentResult directly, which holds actual filename as stored by multer.
    if (fs.existsSync(file_to_delete_from_disk)) {
      fs.unlinkSync(file_to_delete_from_disk);
    }

    await create_activity_and_notify(client, issue_id, user_id, 'attachment_removed', {
        field_name: 'attachment',
        old_value: file_name, project_key
    });

    await client.query('COMMIT');
    res.status(204).send(); // No Content
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete attachment error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.28. Link Issues
app.post('/api/v1/issues/:source_issue_id/links', authenticate_jwt, async (req, res) => {
  const { source_issue_id } = req.params;
  const { target_issue_id, link_type } = req.body;
  const user_id = req.user_id;
  const now = new Date().toISOString();
  const client = await pool.connect();

  if (source_issue_id === target_issue_id) {
    return res.status(400).json({ message: 'Cannot link an issue to itself.' });
  }
  if (link_type !== 'relates_to') {
    return res.status(400).json({ message: 'Invalid link type. Only "relates_to" is supported.' });
  }

  try {
    await client.query('BEGIN');

    // Verify both issues exist and user is member of both projects
    const [sourceIssueRes, targetIssueRes] = await Promise.all([
      client.query(`SELECT project_id, summary FROM issues WHERE id = $1`, [source_issue_id]),
      client.query(`SELECT project_id, summary FROM issues WHERE id = $1`, [target_issue_id])
    ]);

    if (sourceIssueRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Source issue not found.' }); }
    if (targetIssueRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Target issue not found.' }); }

    const source_project_id = sourceIssueRes.rows[0].project_id;
    const target_project_id = targetIssueRes.rows[0].project_id;

    const [sourceRole, targetRole] = await Promise.all([
      check_project_membership(source_project_id, user_id),
      check_project_membership(target_project_id, user_id)
    ]);

    if (!sourceRole || !targetRole) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Forbidden: User must be a member of both projects to link issues.' });
    }

    // Check if link already exists (in either direction)
    const existingLink = await client.query(
      `SELECT id FROM issue_links WHERE (source_issue_id = $1 AND target_issue_id = $2 AND link_type = $3) OR (source_issue_id = $2 AND target_issue_id = $1 AND link_type = $3)`,
      [source_issue_id, target_issue_id, link_type]
    );
    if (existingLink.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Issues are already linked with this type.' });
    }

    const link_id = get_next_id('ilk');
    await client.query(
      `INSERT INTO issue_links (id, source_issue_id, target_issue_id, link_type, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [link_id, source_issue_id, target_issue_id, link_type, now]
    );

    // Log activity on source issue
    const source_project_key = (await client.query(`SELECT project_key FROM projects WHERE id = $1`, [source_project_id])).rows[0].project_key;
    const target_project_key = (await client.query(`SELECT project_key FROM projects WHERE id = $1`, [target_project_id])).rows[0].project_key;

    await create_activity_and_notify(client, source_issue_id, user_id, 'issue_linked', {
      field_name: 'linked_issue', new_value: `${target_project_key}-${targetIssueRes.rows[0].summary}`, project_key: source_project_key
    });

    await client.query('COMMIT');
    res.status(201).json({ id: link_id, source_issue_id, target_issue_id, link_type, created_at: now });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Link issues error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.29. Remove Issue Link
app.delete('/api/v1/issue_links/:link_id', authenticate_jwt, async (req, res) => {
  const { link_id } = req.params;
  const user_id = req.user_id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const linkResult = await client.query(
      `SELECT il.source_issue_id, il.target_issue_id, i_source.project_id AS source_project_id, i_target.summary AS target_summary, p_target.project_key AS target_project_key FROM issue_links il
       JOIN issues i_source ON il.source_issue_id = i_source.id
       JOIN issues i_target ON il.target_issue_id = i_target.id
       JOIN projects p_target ON i_target.project_id = p_target.id
       WHERE il.id = $1`,
      [link_id]
    );
    if (linkResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Issue link not found.' });
    }

    const { source_issue_id, source_project_id, target_summary, target_project_key } = linkResult.rows[0];
    const source_project_key_actual = (await client.query(`SELECT project_key FROM projects WHERE id = $1`, [source_project_id])).rows[0].project_key;

    const userRole = await check_project_membership(source_project_id, user_id);
    if (!userRole) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Forbidden: User is not a member of the project to remove links.' });
    }

    const deleteResult = await client.query(`DELETE FROM issue_links WHERE id = $1`, [link_id]);
    if (deleteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Issue link not found or already removed.' });
    }

    await create_activity_and_notify(client, source_issue_id, user_id, 'issue_unlinked', {
        field_name: 'linked_issue', old_value: `${target_project_key}-${target_summary}`, project_key: source_project_key_actual
    });

    await client.query('COMMIT');
    res.status(204).send(); // No Content
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Remove issue link error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});


// II.B.30. Get Kanban Board Issues
app.get('/api/v1/projects/:project_id/board/issues', authenticate_jwt, check_project_member, async (req, res) => {
  const { project_id } = req.params;
  const { assignee_id, priority, labels } = req.query;
  const user_id = req.user_id;
  const client = await pool.connect();

  try {
    let query = `
      SELECT
        i.id, i.summary, i.status, i.priority, i.assignee_user_id, i.due_date,
        u.first_name, u.last_name, u.profile_picture_url, p.project_key
      FROM issues i
      JOIN projects p ON i.project_id = p.id AND p.id = $1
      LEFT JOIN users u ON i.assignee_user_id = u.id
      WHERE i.parent_issue_id IS NULL -- Only top-level issues for Kanban
    `;
    const values = [project_id];
    let paramIndex = 2;

    if (assignee_id) {
      if (assignee_id === 'me') {
        query += ` AND i.assignee_user_id = $${paramIndex++}`;
        values.push(user_id);
      } else if (assignee_id !== 'all') { // If specific assignee_id provided
        query += ` AND i.assignee_user_id = $${paramIndex++}`;
        values.push(assignee_id);
      }
    }

    if (priority && priority !== 'all') { // Check if priority filter is provided and not 'all'
      query += ` AND i.priority = $${paramIndex++}`;
      values.push(priority);
    }


    if (labels && labels.length > 0) {
      const label_names = Array.isArray(labels) ? labels : [labels];
      // Subquery to check if issue has ANY of the specified labels
      query += ` AND i.id IN (
        SELECT il.issue_id FROM issue_labels il
        JOIN labels l ON il.label_id = l.id
        WHERE l.label_name = ANY($${paramIndex++}::text[])
      )`;
      values.push(label_names);
    }

    query += ` ORDER BY i.rank ASC`; // Order by rank for default prioritization

    const result = await client.query(query, values);

    const issues = result.rows.map(row => ({
      id: row.id,
      issue_key: derive_issue_key(row.project_key, row.id),
      summary: row.summary,
      assignee: map_user_min_details(row),
      priority: row.priority,
      status: row.status,
      due_date: row.due_date,
    }));
    res.status(200).json(issues);
  } catch (error) {
    console.error('Get Kanban board issues error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.31. Update Issue Status (Kanban DnD)
app.put('/api/v1/issues/:issue_id/status', authenticate_jwt, check_issue_project_member, async (req, res) => {
  const { issue_id } = req.params;
  const { new_status } = req.body;
  const user_id = req.user_id;
  const now = new Date().toISOString();
  const client = await pool.connect();

  if (!new_status || !['To Do', 'In Progress', 'Done'].includes(new_status)) {
    return res.status(400).json({ message: 'Invalid new status.' });
  }

  try {
    await client.query('BEGIN');

    const issueInfo = await client.query(
      `SELECT project_id, summary, status, reporter_user_id, assignee_user_id FROM issues WHERE id = $1`,
      [issue_id]
    );
    if (issueInfo.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Issue not found.' });
    }

    const { project_id, summary, status: old_status, reporter_user_id, assignee_user_id } = issueInfo.rows[0];

    // Check if user has permission to change status
    const userRole = await check_project_membership(project_id, user_id);
    if (userRole !== 'Admin' && user_id !== reporter_user_id && user_id !== assignee_user_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Forbidden: User lacks permission to change issue status.' });
    }

    // Validate workflow transition
    let isValidTransition = false;
    if ((old_status === 'To Do' && (new_status === 'In Progress')) ||
        (old_status === 'In Progress' && (new_status === 'To Do' || new_status === 'Done')) ||
        (old_status === 'Done' && new_status === 'In Progress')) { // Reopen from Done
      isValidTransition = true;
    }

    if (!isValidTransition) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Invalid status transition from "${old_status}" to "${new_status}".` });
    }

    const updateResult = await client.query(
      `UPDATE issues SET status = $1, updated_at = $2 WHERE id = $3 RETURNING *`,
      [new_status, now, issue_id]
    );

    const updatedIssue = updateResult.rows[0];
    const project_res = await client.query(`SELECT project_key FROM projects WHERE id = $1`, [project_id]);
    const project_key = project_res.rows[0]?.project_key;

    await create_activity_and_notify(client, issue_id, user_id, 'status_changed', {
      field_name: 'status',
      old_value: old_status,
      new_value: new_status, project_key, reporter_user_id, assignee_user_id
    });

    await client.query('COMMIT');

    res.status(200).json({
      id: updatedIssue.id,
      issue_key: derive_issue_key(project_key, updatedIssue.id),
      summary: updatedIssue.summary,
      status: updatedIssue.status,
      priority: updatedIssue.priority,
      // Re-fetch assignee details because the function was passed basic row info
      assignee: updatedIssue.assignee_user_id ? await map_user_min_details_from_db(client, updatedIssue.assignee_user_id) : null,
      due_date: updatedIssue.due_date
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update issue status error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.32. Get Project Issues List
app.get('/api/v1/projects/:project_id/issues', authenticate_jwt, check_project_member, async (req, res) => {
  const { project_id } = req.params;
  const { issue_type, status, assignee_id, reporter_id, priority, labels, search_query, sort_by = 'rank', sort_order = 'asc' } = req.query;
  const client = await pool.connect();
  const user_id = req.user_id;

  try {
    let query = `
      SELECT
        i.id, i.summary, i.issue_type, i.status, i.assignee_user_id, i.reporter_user_id,
        i.priority, i.due_date, i.rank, i.updated_at,
        p.project_key,
        u_assignee.first_name AS assignee_first_name, u_assignee.last_name AS assignee_last_name, u_assignee.profile_picture_url AS assignee_profile_picture_url,
        u_reporter.first_name AS reporter_first_name, u_reporter.last_name AS reporter_last_name, u_reporter.profile_picture_url AS reporter_profile_picture_url
      FROM issues i
      JOIN projects p ON i.project_id = p.id AND p.id = $1
      LEFT JOIN users u_assignee ON i.assignee_user_id = u_assignee.id
      LEFT JOIN users u_reporter ON i.reporter_user_id = u_reporter.id
      WHERE i.parent_issue_id IS NULL -- Only top-level issues for this list
    `;
    const values = [project_id];
    let paramIndex = 2;

    if (issue_type && issue_type.length > 0) {
      const types = Array.isArray(issue_type) ? issue_type : [issue_type];
      query += ` AND i.issue_type = ANY($${paramIndex++}::text[])`;
      values.push(types);
    }
    if (status && status.length > 0) {
      const statuses = Array.isArray(status) ? status : [status];
      query += ` AND i.status = ANY($${paramIndex++}::text[])`;
      values.push(statuses);
    }
    if (assignee_id && assignee_id.length > 0) {
      const assignees = Array.isArray(assignee_id) ? assignee_id : [assignee_id];
      query += ` AND i.assignee_user_id = ANY($${paramIndex++}::text[])`;
      values.push(assignees);
    } else if (assignee_id === 'unassigned') { // Example custom filter for unassigned
      query += ` AND i.assignee_user_id IS NULL`;
    }
    if (reporter_id && reporter_id.length > 0) {
      const reporters = Array.isArray(reporter_id) ? reporter_id : [reporter_id];
      query += ` AND i.reporter_user_id = ANY($${paramIndex++}::text[])`;
      values.push(reporters);
    } else if (reporter_id === 'me') {
       query += ` AND i.reporter_user_id = $${paramIndex++}`;
       values.push(user_id);
    }

    if (priority && priority.length > 0) {
      const priorities_arr = Array.isArray(priority) ? priority : [priority];
      query += ` AND i.priority = ANY($${paramIndex++}::text[])`;
      values.push(priorities_arr);
    }

    if (labels && labels.length > 0) {
      const label_names = Array.isArray(labels) ? labels : [labels];
      query += ` AND i.id IN (
        SELECT il.issue_id FROM issue_labels il
        JOIN labels l ON il.label_id = l.id
        WHERE l.label_name = ANY($${paramIndex++}::text[])
      )`;
      values.push(label_names);
    }

    if (search_query) {
      query += ` AND (i.summary ILIKE $${paramIndex++} OR i.description ILIKE $${paramIndex++})`;
      values.push(`%${search_query}%`, `S%${search_query}%`);
    }

    // Sorting
    const allowedSortBy = ['rank', 'summary', 'issue_type', 'status', 'priority', 'due_date', 'last_updated_at'];
    const dbColumnMap = {
      summary: 'i.summary', issue_type: 'i.issue_type', status: 'i.status',
      priority: 'i.priority', due_date: 'i.due_date', last_updated_at: 'i.updated_at',
      rank: 'i.rank', assignee: 'u_assignee.first_name', reporter: 'u_reporter.first_name' // Sorting by user names
    };
    if (Object.keys(dbColumnMap).includes(sort_by)) { // Check if sort_by is a valid mapped key
      const order = sort_order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      query += ` ORDER BY ${dbColumnMap[sort_by]} ${order}`;
    } else {
      query += ` ORDER BY i.rank ASC`; // Default sort
    }

    const { rows } = await client.query(query, values);

    const issues = rows.map(row => ({
      id: row.id,
      issue_key: derive_issue_key(row.project_key, row.id),
      summary: row.summary,
      issue_type: row.issue_type,
      status: row.status,
      assignee: row.assignee_user_id ? { id: row.assignee_user_id, first_name: row.assignee_first_name, last_name: row.assignee_last_name, profile_picture_url: row.assignee_profile_picture_url } : null,
      priority: row.priority,
      due_date: row.due_date,
      reporter: { id: row.reporter_user_id, first_name: row.reporter_first_name, last_name: row.reporter_last_name, profile_picture_url: row.reporter_profile_picture_url },
      last_updated_at: row.updated_at,
      rank: row.rank
    }));

    res.status(200).json(issues);
  } catch (error) {
    console.error('Get project issues list error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});


// II.B.33. Update Issue Rank (Prioritization)
app.put('/api/v1/issues/:issue_id/rank', authenticate_jwt, check_issue_project_member, async (req, res) => {
  const { issue_id } = req.params;
  const { new_rank } = req.body;
  const user_id = req.user_id; // For activity log
  const now = new Date().toISOString();
  const client = await pool.connect();

  if (typeof new_rank !== 'number' || new_rank < 1) {
    return res.status(400).json({ message: 'New rank must be a positive number.' });
  }

  try {
    await client.query('BEGIN');

    const issueInfo = await client.query(`SELECT project_id, summary, rank FROM issues WHERE id = $1`, [issue_id]);
    if (issueInfo.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Issue not found.' });
    }
    const { project_id, summary, rank: old_rank } = issueInfo.rows[0];
    const project_key = (await client.query(`SELECT project_key FROM projects WHERE id = $1`, [project_id])).rows[0].project_key;

    // Check permissions (Project Admin or Member) - already handled by check_issue_project_member

    const updateResult = await client.query(
      `UPDATE issues SET rank = $1, updated_at = $2 WHERE id = $3 RETURNING id, rank`,
      [new_rank, now, issue_id]
    );

    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK'); // Should not happen if issueInfo.rows.length > 0
      return res.status(500).json({ message: 'Failed to update issue rank.' });
    }

    await create_activity_and_notify(client, issue_id, user_id, 'priority_changed', { // Using priority_changed for simplification
      field_name: 'rank',
      old_value: old_rank.toString(),
      new_value: new_rank.toString(),
      project_key
    });

    await client.query('COMMIT');
    res.status(200).json({ id: issue_id, rank: new_rank });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update issue rank error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.34. Global Search Issues
app.get('/api/v1/search/issues', authenticate_jwt, async (req, res) => {
  const { query } = req.query;
  const user_id = req.user_id; // For filtering by accessible projects
  const client = await pool.connect();

  if (!query) {
    return res.status(400).json({ message: 'Search query is required.' });
  }

  try {
    const searchTerm = `%${query}%`;
    let globalQuery = `
      SELECT
        i.id, i.summary,
        p.id AS project_id, p.project_name, p.project_key
      FROM issues i
      JOIN projects p ON i.project_id = p.id
      JOIN project_members pm ON p.id = pm.project_id
      WHERE pm.user_id = $1
      AND (i.summary ILIKE $2 OR i.id = $3) -- i.id matches exact internal ID, which can be part of issue_key
      ORDER BY i.updated_at DESC
      LIMIT 100 -- Limit results for performance
    `;
    // For i.id = $3, we want to match the whole internal ID (e.g. 'issue-123')
    // For i.summary ILIKE $2, we want partial match from user input.
    const values = [user_id, searchTerm, query];

    const result = await client.query(globalQuery, values);

    const issues = result.rows.map(row => ({
      id: row.id,
      issue_key: derive_issue_key(row.project_key, row.id), // Derive issue key for display
      summary: row.summary,
      project_id: row.project_id,
      project_name: row.project_name,
      project_key: row.project_key
    }));

    res.status(200).json(issues);
  } catch (error) {
    console.error('Global search issues error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.35. Get My Assigned Issues (Global "My Work")
app.get('/api/v1/users/me/assigned_issues', authenticate_jwt, async (req, res) => {
  const { status, priority, project_id: filter_project_ids } = req.query;
  const user_id = req.user_id;
  const client = await pool.connect();

  try {
    let query = `
      SELECT
        i.id, i.summary, i.issue_type, i.status, i.priority, i.due_date,
        p.id AS project_id, p.project_name, p.project_key
      FROM issues i
      JOIN projects p ON i.project_id = p.id
      WHERE i.assignee_user_id = $1
    `;
    const values = [user_id];
    let paramIndex = 2;

    if (status && status.length > 0) {
      const statuses = Array.isArray(status) ? status : [status];
      query += ` AND i.status = ANY($${paramIndex++}::text[])`;
      values.push(statuses);
    }
    if (priority && priority.length > 0) {
      const priorities_arr = Array.isArray(priority) ? priority : [priority];
      query += ` AND i.priority = ANY($${paramIndex++}::text[])`;
      values.push(priorities_arr);
    }
    if (filter_project_ids && filter_project_ids.length > 0) {
      const project_ids = Array.isArray(filter_project_ids) ? filter_project_ids : [filter_project_ids];
      query += ` AND i.project_id = ANY($${paramIndex++}::text[])`;
      values.push(project_ids);
    }

    query += ` ORDER BY i.due_date ASC NULLS LAST, i.priority ASC`; // Sort by due date, then priority

    const result = await client.query(query, values);

    const issues = result.rows.map(row => ({
      id: row.id,
      issue_key: derive_issue_key(row.project_key, row.id),
      summary: row.summary,
      issue_type: row.issue_type,
      status: row.status,
      priority: row.priority,
      due_date: row.due_date,
      project: map_project_summary(row)
    }));

    res.status(200).json(issues);
  } catch (error) {
    console.error('Get my assigned issues error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.36. Get User Notifications
app.get('/api/v1/users/me/notifications', authenticate_jwt, async (req, res) => {
  const { is_read } = req.query;
  const user_id = req.user_id;
  const client = await pool.connect();

  try {
    let query = `
      SELECT
        n.id, n.issue_id, n.notification_type, n.actor_user_id, n.comment_id, n.summary_text, n.is_read, n.created_at,
        i.summary AS issue_summary,
        p.project_key,
        u_actor.first_name AS actor_first_name, u_actor.last_name AS actor_last_name, u_actor.profile_picture_url AS actor_profile_picture_url,
        c.comment_content
      FROM notifications n
      JOIN issues i ON n.issue_id = i.id
      JOIN projects p ON i.project_id = p.id
      LEFT JOIN users u_actor ON n.actor_user_id = u_actor.id
      LEFT JOIN comments c ON n.comment_id = c.id
      WHERE n.user_id = $1
    `;
    const values = [user_id];
    let paramIndex = 2;

    if (is_read !== undefined) {
      query += ` AND n.is_read = $${paramIndex++}`;
      values.push(is_read === 'true');
    }

    query += ` ORDER BY n.created_at DESC`;

    const notificationsResult = await client.query(query, values);

    const notifications = notificationsResult.rows.map(row => ({
      id: row.id,
      issue_id: row.issue_id,
      issue_key: derive_issue_key(row.project_key, row.issue_id),
      issue_summary: row.issue_summary,
      project_key: row.project_key,
      notification_type: row.notification_type,
      actor: row.actor_user_id ? { id: row.actor_user_id, first_name: row.actor_first_name, last_name: row.actor_last_name, profile_picture_url: row.actor_profile_picture_url } : null,
      comment: row.comment_id ? { id: row.comment_id, content: row.comment_content } : null,
      summary_text: row.summary_text,
      is_read: row.is_read,
      created_at: row.created_at
    }));

    const unreadCountResult = await client.query(`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE`, [user_id]);
    const unread_count = parseInt(unreadCountResult.rows[0].count);

    res.status(200).json({ unread_count, notifications });
  } catch (error) {
    console.error('Get user notifications error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.37. Mark Notification as Read
app.put('/api/v1/notifications/:notification_id/read', authenticate_jwt, async (req, res) => {
  const { notification_id } = req.params;
  const user_id = req.user_id;
  const client = await pool.connect();

  try {
    const result = await client.query(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id`,
      [notification_id, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found or not belonging to user.' });
    }
    res.status(204).send(); // No Content
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// II.B.38. Mark All Notifications as Read
app.put('/api/v1/notifications/mark_all_as_read', authenticate_jwt, async (req, res) => {
  const user_id = req.user_id;
  const client = await pool.connect();

  try {
    await client.query(
      `UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`,
      [user_id]
    );
    res.status(204).send(); // No Content
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});


// Catch-all route for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Server Startup ---
async function start_server() {
  await initialize_id_sequences(); // Initialize ID sequences from DB
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`OpenAPI Spec: ${APP_BASE_URL}/api-docs`); // In a real app, serve docs or use proxy
    console.log(`WebSocket Server: ${APP_BASE_URL}`);
  });
}

start_server();