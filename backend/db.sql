-- Drop tables in reverse order of creation to prevent foreign key constraint issues during recreation.
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS activity_logs CASCADE;
DROP TABLE IF EXISTS issue_links CASCADE;
DROP TABLE IF EXISTS issue_labels CASCADE;
DROP TABLE IF EXISTS labels CASCADE;
DROP TABLE IF EXISTS attachments CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS issues CASCADE;
DROP TABLE IF EXISTS project_members CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS users CASCADE;

--
-- POSTGRESQL COMMANDS TO CREATE TABLES
--

-- Table: users
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    profile_picture_url TEXT,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    email_verification_token TEXT UNIQUE,
    password_reset_token TEXT UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Table: projects
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    project_name TEXT NOT NULL UNIQUE,
    project_key TEXT NOT NULL UNIQUE,
    description TEXT,
    project_lead_user_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    FOREIGN KEY (project_lead_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- Table: project_members
CREATE TABLE project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('Admin', 'Member')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    UNIQUE (project_id, user_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Table: issues
CREATE TABLE issues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    issue_type TEXT NOT NULL CHECK (issue_type IN ('Task', 'Bug', 'Story')),
    summary TEXT NOT NULL,
    description TEXT,
    assignee_user_id TEXT,
    reporter_user_id TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Highest', 'High', 'Medium', 'Low', 'Lowest')),
    status TEXT NOT NULL DEFAULT 'To Do' CHECK (status IN ('To Do', 'In Progress', 'Done')),
    due_date TIMESTAMP WITH TIME ZONE,
    parent_issue_id TEXT,
    rank INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (assignee_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (parent_issue_id) REFERENCES issues(id) ON DELETE SET NULL
);

-- Table: comments
CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    comment_content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- Table: attachments
CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    uploaded_by_user_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- Table: labels
CREATE TABLE labels (
    id TEXT PRIMARY KEY,
    label_name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Table: issue_labels
CREATE TABLE issue_labels (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    UNIQUE (issue_id, label_id),
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
);

-- Table: issue_links
CREATE TABLE issue_links (
    id TEXT PRIMARY KEY,
    source_issue_id TEXT NOT NULL,
    target_issue_id TEXT NOT NULL,
    link_type TEXT NOT NULL CHECK (link_type IN ('relates_to')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    UNIQUE (source_issue_id, target_issue_id, link_type),
    FOREIGN KEY (source_issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY (target_issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    CHECK (source_issue_id != target_issue_id)
);

-- Table: activity_logs
CREATE TABLE activity_logs (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (
        action_type IN (
            'issue_created', 'status_changed', 'comment_added', 'assignee_changed',
            'description_updated', 'summary_updated', 'priority_changed', 'due_date_changed',
            'label_added', 'label_removed', 'attachment_added', 'issue_linked',
            'comment_edited', 'comment_deleted', 'subtask_created', 'parent_issue_changed'
        )
    ),
    field_name TEXT,
    old_value TEXT,
    new_value TEXT,
    comment_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE SET NULL
);

-- Table: notifications
CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    notification_type TEXT NOT NULL CHECK (
        notification_type IN (
            'assigned_to_you', 'new_comment', 'status_change', 'mentioned',
            'issue_updated', 'issue_linked_to_you'
        )
    ),
    actor_user_id TEXT,
    comment_id TEXT,
    summary_text TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE SET NULL
);

--
-- POSTGRESQL COMMANDS TO SEED THE DB
--

-- Seed Data for users
INSERT INTO users (id, email, password_hash, first_name, last_name, profile_picture_url, email_verified, created_at, updated_at) VALUES
('user-101', 'alex.pm@aetherflow.com', 'hashed_pass_alex_123', 'Alex', 'Johnson', 'https://picsum.photos/seed/alex-johnson/200/200', TRUE, NOW() - INTERVAL '60 days', NOW() - INTERVAL '5 days'),
('user-102', 'ben.dev@aetherflow.com', 'hashed_pass_ben_dev_456', 'Ben', 'Smith', 'https://picsum.photos/seed/ben-smith/200/200', TRUE, NOW() - INTERVAL '55 days', NOW() - INTERVAL '3 days'),
('user-103', 'chloe.qa@aetherflow.com', 'hashed_pass_chloe_qa_789', 'Chloe', 'Brown', 'https://picsum.photos/seed/chloe-brown/200/200', TRUE, NOW() - INTERVAL '50 days', NOW() - INTERVAL '1 day'),
('user-104', 'diana.ux@aetherflow.com', 'hashed_pass_diana_ux_321', 'Diana', 'Miller', 'https://picsum.photos/seed/diana-miller/200/200', TRUE, NOW() - INTERVAL '45 days', NOW() - INTERVAL '10 days'),
('user-105', 'evan.pm@aetherflow.com', 'hashed_pass_evan_pm_654', 'Evan', 'White', 'https://picsum.photos/seed/evan-white/200/200', TRUE, NOW() - INTERVAL '40 days', NOW() - INTERVAL '2 days'),
('user-106', 'fiona.dev@aetherflow.com', 'hashed_pass_fiona_dev_987', 'Fiona', 'Green', 'https://picsum.photos/seed/fiona-green/200/200', TRUE, NOW() - INTERVAL '35 days', NOW() - INTERVAL '6 days');

-- Seed Data for projects
INSERT INTO projects (id, project_name, project_key, description, project_lead_user_id, created_at, updated_at) VALUES
('proj-201', 'AetherFlow Core Platform', 'AFC', 'Development and maintenance of the central AetherFlow web application and backend services.', 'user-101', NOW() - INTERVAL '58 days', NOW() - INTERVAL '1 days'),
('proj-202', 'AetherFlow Mobile Initiative', 'AFM', 'Building native iOS and Android applications for AetherFlow users.', 'user-104', NOW() - INTERVAL '48 days', NOW() - INTERVAL '2 days'),
('proj-203', 'Internal Tools & Automation', 'ITA', 'Creating tools to streamline internal AetherFlow operations and improve efficiency.', 'user-105', NOW() - INTERVAL '38 days', NOW() - INTERVAL '0 days');

-- Seed Data for project_members
INSERT INTO project_members (id, project_id, user_id, role, created_at, updated_at) VALUES
('pm-301', 'proj-201', 'user-101', 'Admin', NOW() - INTERVAL '57 days', NOW() - INTERVAL '57 days'), -- Alex as Admin in Core
('pm-302', 'proj-201', 'user-102', 'Member', NOW() - INTERVAL '56 days', NOW() - INTERVAL '56 days'), -- Ben as Member in Core
('pm-303', 'proj-201', 'user-103', 'Member', NOW() - INTERVAL '55 days', NOW() - INTERVAL '55 days'), -- Chloe as Member in Core
('pm-304', 'proj-201', 'user-104', 'Member', NOW() - INTERVAL '54 days', NOW() - INTERVAL '54 days'), -- Diana as Member in Core
('pm-305', 'proj-201', 'user-106', 'Member', NOW() - INTERVAL '53 days', NOW() - INTERVAL '53 days'), -- Fiona as Member in Core
('pm-306', 'proj-202', 'user-104', 'Admin', NOW() - INTERVAL '47 days', NOW() - INTERVAL '47 days'), -- Diana as Admin in Mobile
('pm-307', 'proj-202', 'user-102', 'Member', NOW() - INTERVAL '46 days', NOW() - INTERVAL '46 days'), -- Ben as Member in Mobile
('pm-308', 'proj-202', 'user-106', 'Member', NOW() - INTERVAL '45 days', NOW() - INTERVAL '45 days'), -- Fiona as Member in Mobile
('pm-309', 'proj-203', 'user-105', 'Admin', NOW() - INTERVAL '37 days', NOW() - INTERVAL '37 days'), -- Evan as Admin in Internal Tools
('pm-310', 'proj-203', 'user-102', 'Member', NOW() - INTERVAL '36 days', NOW() - INTERVAL '36 days'); -- Ben as Member in Internal Tools

-- Seed Data for issues (with some self-referencing for parent_issue_id)
INSERT INTO issues (id, project_id, issue_type, summary, description, assignee_user_id, reporter_user_id, priority, status, due_date, parent_issue_id, rank, created_at, updated_at) VALUES
('issue-401', 'proj-201', 'Story', 'As a user, I want to manage my profile settings', 'Enable users to update personal details, password, and receive email notifications.', 'user-102', 'user-101', 'High', 'In Progress', NOW() + INTERVAL '10 days', NULL, 100, NOW() - INTERVAL '30 days', NOW() - INTERVAL '5 days'),
('issue-402', 'proj-201', 'Task', 'Implement profile editing API endpoint', 'Create and test the REST API endpoint for updating user profile data.', 'user-102', 'user-101', 'Highest', 'To Do', NOW() + INTERVAL '7 days', 'issue-401', 90, NOW() - INTERVAL '28 days', NOW() - INTERVAL '2 days'),
('issue-403', 'proj-201', 'Task', 'Develop React UI for profile page', 'Build the frontend components for the user profile editing page using React.', 'user-104', 'user-101', 'High', 'In Progress', NOW() + INTERVAL '12 days', 'issue-401', 80, NOW() - INTERVAL '25 days', NOW() - INTERVAL '1 day'),
('issue-404', 'proj-201', 'Bug', 'Password reset link expires too quickly', 'Investigate and fix the issue where password reset tokens expire prematurely (within 5 minutes).', 'user-102', 'user-103', 'Highest', 'To Do', NULL, NULL, 110, NOW() - INTERVAL '20 days', NOW() - INTERVAL '20 days'),
('issue-405', 'proj-201', 'Story', 'As a project manager, I want an overview of project progress', 'Develop a dashboard to show key metrics, issue statuses, and team activity for projects.', 'user-101', 'user-101', 'High', 'To Do', NOW() + INTERVAL '25 days', NULL, 120, NOW() - INTERVAL '18 days', NOW() - INTERVAL '18 days'),
('issue-406', 'proj-201', 'Task', 'Database schema for activity logs', 'Design and implement the database schema for capturing all issue-related activities.', 'user-102', 'user-105', 'Medium', 'Done', NOW() - INTERVAL '1 day', 'issue-405', 95, NOW() - INTERVAL '15 days', NOW() - INTERVAL '1 day'),
('issue-407', 'proj-202', 'Bug', 'Mobile app crashes on image upload (Android)', 'The Android app crashes inconsistently when attempting to upload profile pictures from gallery.', 'user-106', 'user-103', 'Highest', 'In Progress', NOW() + INTERVAL '5 days', NULL, 100, NOW() - INTERVAL '10 days', NOW()),
('issue-408', 'proj-202', 'Story', 'Implement Offline Mode for Task Viewing', 'Users should be able to view their assigned tasks even without an active internet connection on mobile.', 'user-104', 'user-104', 'Medium', 'To Do', NOW() + INTERVAL '30 days', NULL, 90, NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days'),
('issue-409', 'proj-203', 'Task', 'Automate daily build deployments', 'Create a CI/CD pipeline to automate the daily deployment of internal tools builds to staging environment.', 'user-102', 'user-105', 'High', 'In Progress', NOW() + INTERVAL '15 days', NULL, 100, NOW() - INTERVAL '7 days', NOW() - INTERVAL '3 days'),
('issue-410', 'proj-201', 'Task', 'Update Dependencies', 'Update all npm packages to their latest stable versions for security and performance.', 'user-102', 'user-101', 'Low', 'To Do', NULL, NULL, 50, NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),
('issue-411', 'proj-201', 'Bug', 'Search returns irrelevant results', 'The global search functionality occasionally returns issues that do not match the search query.', 'user-103', 'user-101', 'High', 'To Do', NULL, NULL, 70, NOW() - INTERVAL '12 days', NOW() - INTERVAL '12 days'),
('issue-412', 'proj-201', 'Story', 'Email notifications for comments', 'Users should receive email notifications when someone comments on an issue they are involved in.', 'user-102', 'user-101', 'Medium', 'To Do', NOW() + INTERVAL '14 days', NULL, 85, NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days'),
('issue-413', 'proj-201', 'Task', 'Design email template for new comment notification', 'Create HTML email template for new comment notifications.', 'user-104', 'user-101', 'Low', 'To Do', NOW() + INTERVAL '5 days', 'issue-412', 80, NOW() - INTERVAL '14 days', NOW() - INTERVAL '14 days'),
('issue-414', 'proj-201', 'Task', 'Backend service for sending email notifications', 'Implement a microservice to handle dispatching various email notifications.', 'user-102', 'user-101', 'Medium', 'To Do', NOW() + INTERVAL '10 days', 'issue-412', 75, NOW() - INTERVAL '13 days', NOW() - INTERVAL '13 days');


-- Seed Data for comments
INSERT INTO comments (id, issue_id, user_id, comment_content, created_at, updated_at) VALUES
('comm-501', 'issue-401', 'user-102', 'I\'ll start by mapping out the API requirements for profile updates.', NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days'),
('comm-502', 'issue-401', 'user-101', 'Sounds good, Ben. Let\'s sync up by end of week on the progress.', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),
('comm-503', 'issue-403', 'user-104', 'Initial mockups for the profile page are ready for review. Check Figma link.', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),
('comm-504', 'issue-404', 'user-103', 'Reproduced the password reset issue. It seems the token generation method has a very short validity period.', NOW() - INTERVAL '19 days', NOW() - INTERVAL '19 days'),
('comm-505', 'issue-404', 'user-102', 'Thanks Chloe. I\'m looking into the token validity configuration now.', NOW() - INTERVAL '18 days', NOW() - INTERVAL '18 days'),
('comm-506', 'issue-407', 'user-106', 'Found a potential memory leak related to image processing. Working on a patch.', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
('comm-507', 'issue-409', 'user-102', 'Initial pipeline setup for daily builds is complete. Next, integrating unit tests.', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),
('comm-508', 'issue-406', 'user-102', 'Schema for activity logs finalized and merged. Ready for data population.', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day');

-- Seed Data for attachments
INSERT INTO attachments (id, issue_id, file_name, file_url, mime_type, file_size, uploaded_by_user_id, created_at) VALUES
('att-601', 'issue-403', 'profile_mockup_v1.png', 'https://picsum.photos/seed/profilemockup/800/600', 'image/png', 250000, 'user-104', NOW() - INTERVAL '2 days'),
('att-602', 'issue-404', 'error_log_snapshot.txt', 'https://picsum.photos/seed/errorlog/600/400', 'text/plain', 50000, 'user-103', NOW() - INTERVAL '19 days'),
('att-603', 'issue-407', 'android_crash_stacktrace.txt', 'https://picsum.photos/seed/androidcrash/600/400', 'text/plain', 75000, 'user-106', NOW() - INTERVAL '10 hours');

-- Seed Data for labels
INSERT INTO labels (id, label_name, created_at, updated_at) VALUES
('label-701', 'frontend', NOW() - INTERVAL '25 days', NOW() - INTERVAL '25 days'),
('label-702', 'backend', NOW() - INTERVAL '25 days', NOW() - INTERVAL '25 days'),
('label-703', 'UI/UX', NOW() - INTERVAL '22 days', NOW() - INTERVAL '22 days'),
('label-704', 'database', NOW() - INTERVAL '22 days', NOW() - INTERVAL '22 days'),
('label-705', 'critical', NOW() - INTERVAL '20 days', NOW() - INTERVAL '20 days'),
('label-706', 'mobile-android', NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days'),
('label-707', 'automation', NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days');

-- Seed Data for issue_labels
INSERT INTO issue_labels (id, issue_id, label_id, created_at) VALUES
('isl-801', 'issue-401', 'label-701', NOW() - INTERVAL '29 days'), -- User Profile -> frontend
('isl-802', 'issue-401', 'label-702', NOW() - INTERVAL '29 days'), -- User Profile -> backend
('isl-803', 'issue-402', 'label-702', NOW() - INTERVAL '27 days'), -- API Endpoint -> backend
('isl-804', 'issue-403', 'label-701', NOW() - INTERVAL '24 days'), -- UI for profile -> frontend
('isl-805', 'issue-403', 'label-703', NOW() - INTERVAL '24 days'), -- UI for profile -> UI/UX
('isl-806', 'issue-404', 'label-702', NOW() - INTERVAL '19 days'), -- Password reset bug -> backend
('isl-807', 'issue-404', 'label-705', NOW() - INTERVAL '19 days'), -- Password reset bug -> critical
('isl-808', 'issue-406', 'label-704', NOW() - INTERVAL '14 days'), -- Activity logs DB -> database
('isl-809', 'issue-407', 'label-706', NOW() - INTERVAL '9 days'), -- Mobile crash -> mobile-android
('isl-810', 'issue-407', 'label-705', NOW() - INTERVAL '9 days'), -- Mobile crash -> critical
('isl-811', 'issue-409', 'label-707', NOW() - INTERVAL '6 days'); -- Automation -> automation

-- Seed Data for issue_links
INSERT INTO issue_links (id, source_issue_id, target_issue_id, link_type, created_at) VALUES
('ilk-901', 'issue-401', 'issue-402', 'relates_to', NOW() - INTERVAL '27 days'), -- User profile story to API task
('ilk-902', 'issue-401', 'issue-403', 'relates_to', NOW() - INTERVAL '24 days'), -- User profile story to UI task
('ilk-903', 'issue-405', 'issue-406', 'relates_to', NOW() - INTERVAL '13 days'), -- Project overview story to DB schema task
('ilk-904', 'issue-412', 'issue-413', 'relates_to', NOW() - INTERVAL '14 days'), -- Email notification story to design template task
('ilk-905', 'issue-412', 'issue-414', 'relates_to', NOW() - INTERVAL '13 days'); -- Email notification story to backend service task


-- Seed Data for activity_logs
INSERT INTO activity_logs (id, issue_id, user_id, action_type, field_name, old_value, new_value, comment_id, created_at) VALUES
('act-1001', 'issue-401', 'user-101', 'issue_created', NULL, NULL, NULL, NULL, NOW() - INTERVAL '30 days'),
('act-1002', 'issue-401', 'user-101', 'assignee_changed', NULL, 'user-102', NULL, NULL, NOW() - INTERVAL '29 days'),
('act-1003', 'issue-401', 'user-102', 'status_changed', 'To Do', 'In Progress', NULL, NULL, NOW() - INTERVAL '5 days'),
('act-1004', 'issue-401', 'user-102', 'comment_added', NULL, 'I''ll start by mapping out the API requirements for profile updates.', 'comm-501', NOW() - INTERVAL '4 days'),
('act-1005', 'issue-403', 'user-101', 'issue_created', NULL, NULL, NULL, NULL, NOW() - INTERVAL '25 days'),
('act-1006', 'issue-403', 'user-104', 'comment_added', NULL, 'Initial mockups for the profile page are ready for review. Check Figma link.', 'comm-503', NOW() - INTERVAL '2 days'),
('act-1007', 'issue-404', 'user-103', 'issue_created', NULL, NULL, NULL, NULL, NOW() - INTERVAL '20 days'),
('act-1008', 'issue-404', 'user-103', 'status_changed', 'To Do', 'In Progress', NULL, NULL, NOW() - INTERVAL '19 days'),
('act-1009', 'issue-404', 'user-102', 'assignee_changed', NULL, 'user-102', NULL, NULL, NOW() - INTERVAL '18 days'),
('act-1010', 'issue-406', 'user-105', 'issue_created', NULL, NULL, NULL, NULL, NOW() - INTERVAL '15 days'),
('act-1011', 'issue-406', 'user-102', 'assignee_changed', NULL, 'user-102', NULL, NULL, NOW() - INTERVAL '14 days'),
('act-1012', 'issue-406', 'user-102', 'status_changed', 'To Do', 'Done', NULL, NULL, NOW() - INTERVAL '1 day'),
('act-1013', 'issue-407', 'user-103', 'issue_created', NULL, NULL, NULL, NULL, NOW() - INTERVAL '10 days'),
('act-1014', 'issue-407', 'user-103', 'assignee_changed', NULL, 'user-106', NULL, NULL, NOW() - INTERVAL '9 days'),
('act-1015', 'issue-407', 'user-106', 'status_changed', 'To Do', 'In Progress', NULL, NULL, NOW() - INTERVAL '8 hours'),
('act-1016', 'issue-409', 'user-105', 'issue_created', NULL, NULL, NULL, NULL, NOW() - INTERVAL '7 days'),
('act-1017', 'issue-409', 'user-105', 'assignee_changed', NULL, 'user-102', NULL, NULL, NOW() - INTERVAL '6 days'),
('act-1018', 'issue-409', 'user-102', 'status_changed', 'To Do', 'In Progress', NULL, NULL, NOW() - INTERVAL '3 days');

-- Seed Data for notifications
INSERT INTO notifications (id, user_id, issue_id, notification_type, actor_user_id, comment_id, summary_text, is_read, created_at) VALUES
('notif-1101', 'user-102', 'issue-401', 'assigned_to_you', 'user-101', NULL, 'You were assigned to Issue AFC-401: As a user, I want to manage my profile settings', FALSE, NOW() - INTERVAL '29 days'),
('notif-1102', 'user-101', 'issue-401', 'new_comment', 'user-102', 'comm-501', 'Ben Smith commented on Issue AFC-401: As a user, I want to manage my profile settings', FALSE, NOW() - INTERVAL '4 days'),
('notif-1103', 'user-104', 'issue-403', 'new_comment', 'user-104', 'comm-503', 'Diana Miller added attachments to Issue AFC-403: Develop React UI for profile page', FALSE, NOW() - INTERVAL '2 days'), -- Updated summary_text for attachment
('notif-1104', 'user-102', 'issue-404', 'assigned_to_you', 'user-103', NULL, 'You were assigned to Issue AFC-404: Password reset link expires too quickly', FALSE, NOW() - INTERVAL '18 days'),
('notif-1105', 'user-103', 'issue-404', 'new_comment', 'user-102', 'comm-505', 'Ben Smith commented on Issue AFC-404: Password reset link expires too quickly', FALSE, NOW() - INTERVAL '18 days'),
('notif-1106', 'user-106', 'issue-407', 'assigned_to_you', 'user-103', NULL, 'You were assigned to Issue AFM-407: Mobile app crashes on image upload (Android)', FALSE, NOW() - INTERVAL '9 days'),
('notif-1107', 'user-102', 'issue-406', 'status_change', 'user-102', NULL, 'Issue AFC-406: Database schema for activity logs changed status to Done', FALSE, NOW() - INTERVAL '1 day'),
('notif-1108', 'user-101', 'issue-412', 'issue_created', 'user-101', NULL, 'New Story AFC-412: Email notifications for comments was created.', FALSE, NOW() - INTERVAL '15 days');