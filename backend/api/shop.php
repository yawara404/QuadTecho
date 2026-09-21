<?php
/**
 * GET /api/shop.php  : 生協ストア素材一覧取得
 * POST /api/shop.php : 生協ストアへの新規素材登録
 */

declare(strict_types=1);

require_once __DIR__ . '/../db.php';

$pdo = getDbConnection();
$method = $_SERVER['REQUEST_METHOD'];

// ==========================================
// 1. GET: 素材一覧取得
// ==========================================
if ($method === 'GET') {
    try {
        $stmt = $pdo->prepare('
            SELECT 
                s.id,
                s.creator_id,
                u.display_name AS creator_name,
                s.title,
                s.category,
                s.image_path,
                s.price_points,
                s.downloads_count,
                s.created_at
            FROM shop_assets s
            INNER JOIN users u ON s.creator_id = u.id
            ORDER BY s.downloads_count DESC, s.created_at DESC
        ');
        $stmt->execute();
        $assets = $stmt->fetchAll();

        jsonResponse([
            'success' => true,
            'count'   => count($assets),
            'assets'  => $assets,
        ]);
    } catch (PDOException $e) {
        jsonResponse([
            'success' => false,
            'error'   => '素材一覧の取得に失敗しました: ' . $e->getMessage()
        ], 500);
    }
}

// ==========================================
// 2. POST: 新規素材登録
// ==========================================
if ($method === 'POST') {
    $input = getJsonInput();

    $creatorId = isset($input['creator_id']) ? (int)$input['creator_id'] : 1;
    $title = trim($input['title'] ?? '');
    $category = in_array($input['category'] ?? '', ['sticker', 'tape', 'stamp', 'template'], true)
        ? $input['category']
        : 'sticker';
    $imagePath = trim($input['image_path'] ?? '');
    $pricePoints = isset($input['price_points']) ? (int)$input['price_points'] : 0;

    if ($title === '' || $imagePath === '') {
        jsonResponse([
            'success' => false,
            'error'   => 'タイトルと画像パスは必須です。'
        ], 400);
    }

    try {
        $stmt = $pdo->prepare('
            INSERT INTO shop_assets (
                creator_id,
                title,
                category,
                image_path,
                price_points
            ) VALUES (
                :creator_id,
                :title,
                :category,
                :image_path,
                :price_points
            )
        ');

        $stmt->execute([
            ':creator_id'    => $creatorId,
            ':title'         => $title,
            ':category'      => $category,
            ':image_path'    => $imagePath,
            ':price_points'  => $pricePoints,
        ]);

        jsonResponse([
            'success'  => true,
            'message'  => '生協ストアに素材を登録しました！',
            'asset_id' => (int)$pdo->lastInsertId(),
        ], 201);
    } catch (PDOException $e) {
        jsonResponse([
            'success' => false,
            'error'   => '素材の登録に失敗しました: ' . $e->getMessage()
        ], 500);
    }
}

jsonResponse([
    'success' => false,
    'error'   => '未対応のHTTPメソッドです。'
], 405);
