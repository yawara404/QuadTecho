-- ==========================================================
-- QuadTecho (クアッド・テチョウ) Database Schema (MySQL 8.x)
-- ==========================================================

CREATE DATABASE IF NOT EXISTS quadtecho_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE quadtecho_db;

-- 1. users テーブル（ユーザー基本情報）
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE COMMENT '学籍ID/ログインアカウント名',
  display_name VARCHAR(100) NOT NULL COMMENT '表示名（ニックネーム）',
  circle_name VARCHAR(100) DEFAULT '未所属' COMMENT '所属サークル名',
  circle_id INT NULL COMMENT '所属サークルID（circles.id）',
  avatar_url VARCHAR(255) NULL COMMENT 'アバター画像URL',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ユーザーマスタ';

-- 1b. circles テーブル（サークル・部活マスタ）＋ circle_members（所属）
CREATE TABLE IF NOT EXISTS circles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(40) NOT NULL UNIQUE COMMENT 'サークル名',
  description VARCHAR(500) NOT NULL DEFAULT '' COMMENT '紹介文',
  founder_user_id INT NULL COMMENT '設立者ユーザーID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_circle_founder
    FOREIGN KEY (founder_user_id) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='サークルマスタ';

CREATE TABLE IF NOT EXISTS circle_members (
  circle_id INT NOT NULL COMMENT 'サークルID',
  user_id INT NOT NULL COMMENT 'メンバーユーザーID',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (circle_id, user_id),
  CONSTRAINT fk_member_circle
    FOREIGN KEY (circle_id) REFERENCES circles(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_member_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='サークル所属';

-- 1c. circle_stickers テーブル（サークルで配布する自作シール）
CREATE TABLE IF NOT EXISTS circle_stickers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  circle_id INT NOT NULL COMMENT '配布先サークルID',
  creator_user_id INT NOT NULL COMMENT '作成・配布したユーザーID',
  name VARCHAR(60) NOT NULL COMMENT 'シール名',
  image_url TEXT NOT NULL COMMENT 'シール画像（dataURL または アップロード先パス）',
  category VARCHAR(40) NOT NULL DEFAULT 'オリジナル' COMMENT 'シール種別',
  downloads_count INT NOT NULL DEFAULT 0 COMMENT '取得された回数',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_circle_sticker_circle (circle_id),
  CONSTRAINT fk_circle_sticker_circle
    FOREIGN KEY (circle_id) REFERENCES circles(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_circle_sticker_creator
    FOREIGN KEY (creator_user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='サークル配布シール';

-- 1d. user_stickers テーブル（ユーザーが入手したシール）
CREATE TABLE IF NOT EXISTS user_stickers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL COMMENT '入手したユーザーID',
  name VARCHAR(60) NOT NULL COMMENT 'シール名',
  image_url TEXT NOT NULL COMMENT 'シール画像',
  category VARCHAR(40) NOT NULL DEFAULT 'オリジナル' COMMENT 'シール種別',
  source VARCHAR(20) NOT NULL DEFAULT 'circle' COMMENT '入手元(circle/board/upload)',
  source_id INT NULL COMMENT '入手元ID（サークルIDや投稿ID）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_sticker (user_id, image_url(255)),
  CONSTRAINT fk_user_sticker_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ユーザー入手シール';

-- 1e. circle_messages テーブル（サークル専用ページのチャット）
CREATE TABLE IF NOT EXISTS circle_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  circle_id INT NOT NULL COMMENT 'チャットのあるサークルID',
  user_id INT NOT NULL COMMENT '発言者ユーザーID',
  content VARCHAR(500) NOT NULL COMMENT 'メッセージ本文',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_circle_message_circle (circle_id, id),
  CONSTRAINT fk_circle_message_circle
    FOREIGN KEY (circle_id) REFERENCES circles(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_circle_message_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='サークルチャット';

-- 2. techo_items テーブル（手帳キャンバス上のアイテム）-- ※画像バイナリは持たず、保存されたファイルURL(image_url)のみを保持
CREATE TABLE IF NOT EXISTS techo_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL COMMENT '所有ユーザーID',
  item_type ENUM('sticky_note', 'sticker', 'todo') NOT NULL DEFAULT 'sticky_note' COMMENT 'アイテム種別',
  content TEXT NULL COMMENT '付箋テキスト/メモ内容',
  image_url VARCHAR(255) NULL COMMENT 'シール画像ファイルの相対パス/URL',
  x FLOAT NOT NULL DEFAULT 40.0 COMMENT 'キャンバス上X座標(px)',
  y FLOAT NOT NULL DEFAULT 40.0 COMMENT 'キャンバス上Y座標(px)',
  width FLOAT NOT NULL DEFAULT 160.0 COMMENT 'アイテム幅(px)',
  height FLOAT NOT NULL DEFAULT 140.0 COMMENT 'アイテム高さ(px)',
  rotation FLOAT NOT NULL DEFAULT 0.0 COMMENT '回転角度(-180.0 ~ 180.0度)',
  z_index INT NOT NULL DEFAULT 1 COMMENT '重なり順',
  bg_color VARCHAR(30) NOT NULL DEFAULT '#fff9c4' COMMENT '付箋の背景色カラーコード',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  CONSTRAINT fk_techo_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='手帳キャンバス配置アイテム';

-- 3. bulletin_posts テーブル（部室掲示板に投稿された付箋データ）
CREATE TABLE IF NOT EXISTS bulletin_posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL COMMENT '投稿者ユーザーID',
  title VARCHAR(100) NOT NULL COMMENT '掲示板カードのタイトル',
  content TEXT NOT NULL COMMENT '付箋テキストメッセージ',
  sticker_url VARCHAR(255) NULL COMMENT '添えられたシール画像URL',
  bg_color VARCHAR(30) NOT NULL DEFAULT '#ffeaa7' COMMENT '掲示カードのカラー',
  is_pinned TINYINT(1) NOT NULL DEFAULT 0 COMMENT '重要なお知らせピン留めフラグ',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bulletin_user (user_id),
  INDEX idx_bulletin_created (created_at DESC),
  CONSTRAINT fk_bulletin_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部室掲示板投稿';

-- 4. shop_assets テーブル（生協で配布・共有されるシール素材）
CREATE TABLE IF NOT EXISTS shop_assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  creator_id INT NOT NULL COMMENT '作成・出品者ユーザーID',
  title VARCHAR(100) NOT NULL COMMENT 'シール素材名',
  category ENUM('sticker', 'tape', 'stamp', 'template') NOT NULL DEFAULT 'sticker' COMMENT '素材カテゴリ',
  image_path VARCHAR(255) NOT NULL COMMENT '素材画像ファイル相対パス',
  price_points INT NOT NULL DEFAULT 0 COMMENT '生協ポイント価格(0=無料)',
  downloads_count INT NOT NULL DEFAULT 0 COMMENT '利用・取得回数',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_shop_creator (creator_id),
  INDEX idx_shop_category (category),
  CONSTRAINT fk_shop_creator
    FOREIGN KEY (creator_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生協ストア素材アイテム';

-- 初期シードデータ（ゲスト1件）
INSERT INTO users (id, username, display_name, circle_name) VALUES
  (1, 'guest', 'ゲスト', '未所属')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO techo_items (id, user_id, item_type, content, image_url, x, y, width, height, rotation, z_index, bg_color) VALUES
  (1, 1, 'sticky_note', '火曜2限：情報工学のレポート提出！\n図書館で調べる', NULL, 60, 60, 180, 140, -3, 1, '#fff9c4'),
  (2, 1, 'sticky_note', '週末サークル部室ミーティング\n議題：新歓企画について', NULL, 280, 80, 190, 140, 2, 2, '#d1f2fd'),
  (3, 1, 'sticker', NULL, '/uploads/sample_coffee.png', 180, 220, 100, 100, 8, 3, 'transparent')
ON DUPLICATE KEY UPDATE content=VALUES(content);

INSERT INTO bulletin_posts (user_id, title, content, bg_color, is_pinned) VALUES
  (1, '部室の鍵について', '今週金曜日の部室施錠当番はゲストです！よろしくね。', '#fed330', 1),
  (1, '新歓チラシできました', '生協前掲示板の許可取れました。付箋見てね！', '#a8e6cf', 0);
