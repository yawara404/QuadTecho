"""Run with: python3 -m unittest discover -s tests"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'flask_server'))
import database


class BoardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.original_path = database.DB_PATH
        database.DB_PATH = str(Path(cls.temp.name) / 'test.db')
        import app
        database.init_db()
        cls.client = app.app.test_client()

    @classmethod
    def tearDownClass(cls):
        database.DB_PATH = cls.original_path
        cls.temp.cleanup()

    def test_conversation_persists_for_other_users(self):
        response = self.client.post('/api/board', json={
            'user_id': 1, 'title': '勉強会', 'content': '一緒に勉強しよう'})
        self.assertEqual(response.status_code, 201)
        post_id = response.json['post_id']
        url = f'/api/board/{post_id}'
        login_res = self.client.post('/api/users/login', json={'username': 'commenter'})
        self.assertEqual(login_res.status_code, 200)
        other_id = login_res.json['user']['id']
        for _ in range(2):
            self.assertEqual(self.client.put(url + '/likes', json={
                'user_id': other_id, 'liked': True}).status_code, 200)
        self.assertEqual(self.client.post(url + '/comments', json={
            'user_id': other_id, 'content': '参加します！'}).status_code, 201)
        post = next(p for p in self.client.get('/api/board').json['posts'] if p['id'] == post_id)
        self.assertEqual(post['likes'], [other_id])
        self.assertEqual(post['comments'][0]['content'], '参加します！')
        self.assertEqual(post['comments'][0]['author_name'], 'commenter')
        self.client.put(url + '/likes', json={'user_id': other_id, 'liked': False})
        post = next(p for p in self.client.get('/api/board').json['posts'] if p['id'] == post_id)
        self.assertEqual(post['likes'], [])

    def test_invalid_interactions(self):
        self.assertEqual(self.client.post('/api/board/1/comments', json={
            'user_id': 1, 'content': '  '}).status_code, 400)
        self.assertEqual(self.client.post('/api/board/1/comments', json={
            'user_id': 1, 'content': 'a' * 501}).status_code, 400)
        self.assertEqual(self.client.put('/api/board/999999/likes', json={
            'user_id': 1, 'liked': True}).status_code, 404)
        self.assertEqual(self.client.put('/api/board/1/likes', json={
            'user_id': 999999, 'liked': True}).status_code, 404)
        self.assertEqual(self.client.post('/api/board', json={
            'user_id': 1, 'title': 'a' * 101, 'content': 'test'}).status_code, 400)

    def test_migration_preserves_posts(self):
        before = self.client.get('/api/board').json['posts']
        database.init_db()
        self.assertEqual(before, self.client.get('/api/board').json['posts'])
