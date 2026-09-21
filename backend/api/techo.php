<?php
/**
 * GET /api/techo.php  : 手帳アイテム一覧取得
 * POST /api/techo.php : 手帳アイテム一括保存（同期）
 */

declare(strict_types=1);

require_once __DIR__ . '/../db.php';

$pdo = getDbConnection();
$method = $_SERVER['REQUEST_METHOD'];

// ==========================================
// 1. GET: 手帳アイテム一覧取得
// ==========================================
if ($method === 'GET') {
    $userId = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 1;

    try {
        $stmt = $pdo->prepare('
            SELECT 
                id,
                user_id,
                item_type,
                content,
                image_url,
                x,
                y,
                width,
                height,
                rotation,
                z_index,
                bg_color,
                created_at,
                updated_at
            FROM techo_items
            WHERE user_id = :user_id
            ORDER BY z_index ASC, id ASC
        ');
        $stmt->execute([':user_id' => $userId]);
        $items = $stmt->fetchAll();

        // 数値型へのキャスト整形
        $formattedItems = array_map(function ($item) {
            return [
                'id'         => (int)$item['id'],
                'user_id'    => (int)$item['user_id'],
                'item_type'  => $item['item_type'],
                'content'    => $item['content'] ?? '',
                'image_url'  => $item['image_url'],
                'x'          => (float)$item['x'],
                'y'          => (float)$item['y'],
                'width'      => (float)$item['width'],
                'height'     => (float)$item['height'],
                'rotation'   => (float)$item['rotation'],
                'z_index'    => (int)$item['z_index'],
                'bg_color'   => $item['bg_color'] ?? '#fff9c4',
                'created_at' => $item['created_at'],
                'updated_at' => $item['updated_at'],
            ];
        }, $items);

        jsonResponse([
            'success' => true,
            'user_id' => $userId,
            'count'   => count($formattedItems),
            'items'   => $formattedItems,
        ]);
    } catch (PDOException $e) {
        jsonResponse([
            'success' => false,
            'error'   => '手帳アイテムの取得に失敗しました: ' . $e->getMessage()
        ], 500);
    }
}

// ==========================================
// 2. POST: 手帳アイテム一括保存（同期）
// ==========================================
if ($method === 'POST') {
    $input = getJsonInput();

    $userId = isset($input['user_id']) ? (int)$input['user_id'] : 1;
    $items = isset($input['items']) && is_array($input['items']) ? $input['items'] : [];

    try {
        // トランザクション開始
        $pdo->beginTransaction();

        // 既存のユーザー配置アイテムを一度クリアして最新の状態で再構築
        $deleteStmt = $pdo->prepare('DELETE FROM techo_items WHERE user_id = :user_id');
        $deleteStmt->execute([':user_id' => $userId]);

        // 新規アイテムの一括挿入用プリペアドステートメント
        $insertStmt = $pdo->prepare('
            INSERT INTO techo_items (
                user_id,
                item_type,
                content,
                image_url,
                x,
                y,
                width,
                height,
                rotation,
                z_index,
                bg_color
            ) VALUES (
                :user_id,
                :item_type,
                :content,
                :image_url,
                :x,
                :y,
                :width,
                :height,
                :rotation,
                :z_index,
                :bg_color
            )
        ');

        $insertedCount = 0;
        foreach ($items as $index => $item) {
            $itemType = in_array($item['item_type'] ?? '', ['sticky_note', 'sticker', 'todo'], true)
                ? $item['item_type']
                : 'sticky_note';

            $insertStmt->execute([
                ':user_id'   => $userId,
                ':item_type' => $itemType,
                ':content'   => isset($item['content']) ? (string)$item['content'] : null,
                ':image_url' => !empty($item['image_url']) ? (string)$item['image_url'] : null,
                ':x'         => isset($item['x']) ? (float)$item['x'] : 0.0,
                ':y'         => isset($item['y']) ? (float)$item['y'] : 0.0,
                ':width'     => isset($item['width']) ? (float)$item['width'] : 160.0,
                ':height'    => isset($item['height']) ? (float)$item['height'] : 140.0,
                ':rotation'  => isset($item['rotation']) ? (float)$item['rotation'] : 0.0,
                ':z_index'   => isset($item['z_index']) ? (int)$item['z_index'] : ($index + 1),
                ':bg_color'  => isset($item['bg_color']) ? (string)$item['bg_color'] : '#fff9c4',
            ]);
            $insertedCount++;
        }

        // トランザクションコミット
        $pdo->commit();

        jsonResponse([
            'success' => true,
            'message' => '手帳キャンバスの内容を保存しました。',
            'user_id' => $userId,
            'saved_count' => $insertedCount,
        ]);
    } catch (Exception $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        jsonResponse([
            'success' => false,
            'error'   => '手帳の保存に失敗しました: ' . $e->getMessage()
        ], 500);
    }
}

jsonResponse([
    'success' => false,
    'error'   => '未対応のHTTPメソッドです。GETまたはPOSTを使用してください。'
], 405);
