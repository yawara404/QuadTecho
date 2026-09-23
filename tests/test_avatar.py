"""Run with: python3 -m unittest discover -s tests"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'flask_server'))
import database


class AvatarTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.original_path = database.DB_PATH
        database.DB_PATH = str(Path(cls.temp.name) / 'test_avatar.db')
        import app  # noqa: F401
        database.init_db()
        cls.client = app.app.test_client()

    @classmethod
    def tearDownClass(cls):
        database.DB_PATH = cls.original_path
        cls.temp.cleanup()

    def test_users_list_exposes_avatar_url(self):
        users = self.client.get('/api/users').json['users']
        self.assertIn('avatar_url', users[0])
        self.assertIsNone(users[0]['avatar_url'])

    def test_profile_update_sets_and_clears_avatar(self):
        user = self.client.post('/api/users/login', json={
            'username': 'icon_user', 'display_name': 'アイコン太郎'}).json['user']
        self.assertIsNone(user.get('avatar_url'))

        # アップロード済みパスを設定できる
        res = self.client.put(f"/api/users/{user['id']}", json={
            'display_name': 'アイコン太郎', 'avatar_url': '/uploads/abc.webp'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json['user']['avatar_url'], '/uploads/abc.webp')

        # data URL も許可（オフライン時用）
        data_url = 'data:image/webp;base64,AAAA'
        res = self.client.put(f"/api/users/{user['id']}", json={
            'display_name': 'アイコン太郎', 'avatar_url': data_url})
        self.assertEqual(res.json['user']['avatar_url'], data_url)

        # 空文字はアイコン解除（None になる）
        res = self.client.put(f"/api/users/{user['id']}", json={
            'display_name': 'アイコン太郎', 'avatar_url': ''})
        self.assertIsNone(res.json['user']['avatar_url'])

        # avatar_url を送らない場合は既存値を保持する
        self.client.put(f"/api/users/{user['id']}", json={
            'display_name': 'アイコン太郎', 'avatar_url': '/uploads/keep.webp'})
        res = self.client.put(f"/api/users/{user['id']}", json={'display_name': 'アイコン次郎'})
        self.assertEqual(res.json['user']['avatar_url'], '/uploads/keep.webp')

    def test_profile_update_rejects_bad_avatar(self):
        user = self.client.post('/api/users/login', json={'username': 'bad_icon'}).json['user']
        for bad in ('javascript:alert(1)', 'ftp://example.com/x.png', '../../etc/passwd'):
            res = self.client.put(f"/api/users/{user['id']}", json={
                'display_name': 'x', 'avatar_url': bad})
            self.assertEqual(res.status_code, 400, f'{bad!r} が拒否されていない')

    def test_board_and_chat_expose_author_avatar(self):
        user = self.client.post('/api/users/login', json={
            'username': 'board_icon', 'display_name': '掲示板さん'}).json['user']
        self.client.put(f"/api/users/{user['id']}", json={
            'display_name': '掲示板さん', 'avatar_url': '/uploads/board.webp'})

        post = self.client.post('/api/board', json={
            'user_id': user['id'], 'title': 'こんにちは', 'content': 'テスト投稿'})
        self.assertEqual(post.status_code, 201)
        post_id = post.json['post_id']
        self.client.post(f'/api/board/{post_id}/comments', json={
            'user_id': user['id'], 'content': 'コメント'})

        board = self.client.get('/api/board').json['posts']
        target = next(p for p in board if p['id'] == post_id)
        self.assertEqual(target['author_avatar_url'], '/uploads/board.webp')
        self.assertEqual(target['comments'][0]['author_avatar_url'], '/uploads/board.webp')

        # サークルチャット
        circle = self.client.post('/api/circles', json={
            'name': 'アイコン部', 'founder_user_id': user['id']}).json['circle']
        self.client.post(f"/api/circles/{circle['id']}/messages", json={
            'user_id': user['id'], 'content': 'こんにちは'})
        msgs = self.client.get(f"/api/circles/{circle['id']}/messages").json['messages']
        self.assertEqual(msgs[0]['author_avatar_url'], '/uploads/board.webp')

        # メンバー一覧
        detail = self.client.get(f"/api/circles/{circle['id']}").json['circle']
        self.assertEqual(detail['members'][0]['avatar_url'], '/uploads/board.webp')


if __name__ == '__main__':
    unittest.main()
