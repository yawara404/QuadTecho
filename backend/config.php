<?php
/**
 * QuadTecho (クアッド・テチョウ) 共通設定ファイル
 */

declare(strict_types=1);

// データベース接続設定（環境変数またはデフォルト値）
define('DB_HOST', getenv('DB_HOST') ?: '127.0.0.1');
define('DB_PORT', getenv('DB_PORT') ?: '3306');
define('DB_NAME', getenv('DB_NAME') ?: 'quadtecho_db');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: '');

// アップロード先ディレクトリの絶対パス
define('UPLOAD_DIR', __DIR__ . '/uploads/');
// Webアクセス時の相対URLプレフィックス
define('UPLOAD_URL_PREFIX', '/uploads/');

// 許可する画像MIMEタイプと対応する拡張子
define('ALLOWED_IMAGE_TYPES', [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/webp' => 'webp',
    'image/gif'  => 'gif',
]);

// 画像最大ファイルサイズ (5MB)
define('MAX_FILE_SIZE', 5 * 1024 * 1024);
