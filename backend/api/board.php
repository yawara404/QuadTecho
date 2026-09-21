<?php
/**
 * GET /api/board.php  : 部室掲示板の投稿一覧取得
 * POST /api/board.php : 部室掲示板への新規付箋投稿
 */

declare(strict_types=1);

require_once __DIR__ . '/../db.php';

$pdo = getDbConnection();
$method = $_SERVER['REQUEST_METHOD'];

// ==========================================
// 1. GET: 掲示板一覧取得
// ==========================================
if ($method === 'GET') {
    try {
        $stmt = $pdo->prepare('
            SELECT 
                b.id,
                b.user_id,
                u.display_name AS author_name,
                u.circle_name,
                b.title,
                b.content,
                b.sticker_url,
                b.bg_color,
                b.is_pinned,
                b.created_at
            FROM bulletin_posts b
            INNER JOIN users u ON b.user_id = u.id
            ORDER BY b.is_pinned DESC, b.created_at DESC
        ');
        $stmt->execute();
        $posts = $stmt->fetchAll();

        $formattedPosts = array_map(function ($p) {
            return [
                'id'          => (int)$p['id'],
                'user_id'     => (int)$p['user_id'],
                'author_name' => $p['author_name'],
                'circle_name' => $p['circle_name'],
                'title'       => $p['title'],
                'content'     => $p['content'],
                'sticker_url' => $p['sticker_url'],
                'bg_color'    => $p['bg_color'],
                'is_pinned'   => (bool)$p['is_pinned'],
                'created_at'  => $p['created_at'],
            ];
        }, $posts);

        jsonResponse([
            'success' => true,
            'count'   => count($formattedPosts),
            'posts'   => $formattedPosts,
        ]);
    } catch (PDOException $e) {
        jsonResponse([
            'success' => false,
            'error'   => '掲示板の取得に失敗しました: ' . $e->getMessage()
        ], 500);
    }
}

// ==========================================
// 2. POST: 掲示板への新規投稿
// ==========================================
if ($method === 'POST') {
    $input = getJsonInput();

    $userId = isset($input['user_id']) ? (int)$input['user_id'] : 1;
    $title = trim($input['title'] ?? '');
    $content = trim($input['content'] ?? '');
    $stickerUrl = !empty($input['sticker_url']) ? trim($input['sticker_url']) : null;
    $bgColor = !empty($input['bg_color']) ? trim($input['bg_color']) : '#ffeaa7';
    $isPinned = !empty($input['is_pinned']) ? 1 : 0;

    if ($title === '' || $content === '') {
        jsonResponse([
            'success' => false,
            'error'   => 'タイトルと本文は必須項目です。'
        ], 400);
    }

    try {
        $stmt = $pdo->prepare('
            INSERT INTO bulletin_posts (
                user_id,
                title,
                content,
                sticker_url,
                bg_color,
                is_pinned
            ) VALUES (
                :user_id,
                :title,
                :content,
                :sticker_url,
                :bg_color,
                :is_pinned
            )
        ');

        $stmt->execute([
            ':user_id'     => $userId,
            ':title'       => $title,
            ':content'     => $content,
            ':sticker_url' => $stickerUrl,
            ':bg_color'    => $bgColor,
            ':is_pinned'   => $isPinned,
        ]);

        $newPostId = (int)$pdo->lastInsertId();

        jsonResponse([
            'success' => true,
            'message' => '部室掲示板に付箋を投稿しました！',
            'post_id' => $newPostId,
        ], 201);
    } catch (PDOException $e) {
        jsonResponse([
            'success' => false,
            'error'   => '掲示板の投稿に失敗しました: ' . $e->getMessage()
        ], 500);
    }
}

jsonResponse([
    'success' => false,
    'error'   => '未対応のHTTPメソッドです。'
], 405);
