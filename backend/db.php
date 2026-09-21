<?php
/**
 * QuadTecho (クアッド・テチョウ) データベース接続＆共通ヘルパー
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

// CORSヘッダー設定（フロントエンドVue開発サーバー等からのリクエストを許可）
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Content-Type: application/json; charset=UTF-8');

// プリフライト（OPTIONS）リクエストの早期終了
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

/**
 * PDOデータベース接続を取得
 *
 * @return PDO
 */
function getDbConnection(): PDO
{
    static $pdo = null;

    if ($pdo === null) {
        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
            DB_HOST,
            DB_PORT,
            DB_NAME
        );

        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false, // プリペアドステートメントのエミュレーションを無効化（SQLインジェクション対策強化）
        ];

        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            jsonResponse([
                'success' => false,
                'error'   => 'データベース接続に失敗しました: ' . $e->getMessage()
            ], 500);
        }
    }

    return $pdo;
}

/**
 * JSONレスポンス出力ヘルパー関数
 *
 * @param array<string, mixed> $data
 * @param int $statusCode
 * @return void
 */
function jsonResponse(array $data, int $statusCode = 200): void
{
    http_response_code($statusCode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * リクエストボディのJSONをパースして取得
 *
 * @return array<string, mixed>
 */
function getJsonInput(): array
{
    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}
