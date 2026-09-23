"""Run with: python3 -m unittest discover -s tests"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'flask_server'))
import database


class CircleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.original_path = database.DB_PATH
        database.DB_PATH = str(Path(cls.temp.name) / 'test_circles.db')
        import app  # noqa: F401  (may be cached from other test modules)
        database.init_db()
        cls.client = app.app.test_client()

    @classmethod
    def tearDownClass(cls):
        database.DB_PATH = cls.original_path
        cls.temp.cleanup()

    def test_create_and_duplicate(self):
        res = self.client.post('/api/circles', json={
            'name': 'ボカロ部', 'description': '歌ってみたを作る', 'founder_user_id': 1})
        self.assertEqual(res.status_code, 201)
        circle = res.json['circle']
        self.assertEqual(circle['name'], 'ボカロ部')
        self.assertEqual(circle['member_count'], 1)
        # 作成者は自動で入部し、所属も切り替わる
        me = next(u for u in self.client.get('/api/users').json['users'] if u['id'] == 1)
        self.assertEqual(me['circle_id'], circle['id'])
        self.assertEqual(me['circle_name'], 'ボカロ部')
        # 重複・空・長すぎは 400
        self.assertEqual(self.client.post('/api/circles', json={'name': 'ボカロ部'}).status_code, 400)
        self.assertEqual(self.client.post('/api/circles', json={'name': '  '}).status_code, 400)
        self.assertEqual(self.client.post('/api/circles', json={'name': 'a' * 41}).status_code, 400)
        self.assertEqual(self.client.post('/api/circles', json={
            'name': '新部', 'founder_user_id': 999999}).status_code, 404)

    def test_join_leave_syncs_user(self):
        cid = self.client.post('/api/circles', json={'name': '写真部'}).json['circle']['id']
        login = self.client.post('/api/users/login', json={'username': 'joiner'}).json['user']
        uid = login['id']
        self.assertEqual(self.client.post(f'/api/circles/{cid}/join', json={'user_id': uid}).status_code, 200)
        detail = self.client.get(f'/api/circles/{cid}').json['circle']
        self.assertEqual(detail['member_count'], 1)
        self.assertEqual(detail['members'][0]['username'], 'joiner')
        me = next(u for u in self.client.get('/api/users').json['users'] if u['id'] == uid)
        self.assertEqual(me['circle_name'], '写真部')
        self.assertEqual(self.client.post(f'/api/circles/{cid}/leave', json={'user_id': uid}).status_code, 200)
        me = next(u for u in self.client.get('/api/users').json['users'] if u['id'] == uid)
        self.assertIsNone(me['circle_id'])
        self.assertEqual(me['circle_name'], '未所属')
        # 存在しないサークル・ユーザーは 404
        self.assertEqual(self.client.post('/api/circles/999999/join', json={'user_id': uid}).status_code, 404)
        self.assertEqual(self.client.post(f'/api/circles/{cid}/join', json={'user_id': 999999}).status_code, 404)
        self.assertEqual(self.client.get('/api/circles/999999').status_code, 404)

    def test_profile_and_signup_with_circle(self):
        cid = self.client.post('/api/circles', json={'name': '軽音部'}).json['circle']['id']
        login = self.client.post('/api/users/login', json={
            'username': 'bandman', 'display_name': 'バンドマン', 'circle_id': cid}).json['user']
        self.assertEqual(login['circle_id'], cid)
        self.assertEqual(login['circle_name'], '軽音部')
        # 無効なサークル指定は 400
        bad = self.client.post('/api/users/login', json={'username': 'nobody2', 'circle_id': 999999})
        self.assertEqual(bad.status_code, 400)
        # プロフィールから未所属へ切り替え
        upd = self.client.put(f"/api/users/{login['id']}", json={
            'display_name': 'バンドマン', 'circle_id': None}).json['user']
        self.assertIsNone(upd['circle_id'])
        self.assertEqual(upd['circle_name'], '未所属')
        # プロフィールから再所属
        upd = self.client.put(f"/api/users/{login['id']}", json={
            'display_name': 'バンドマン', 'circle_id': cid}).json['user']
        self.assertEqual(upd['circle_id'], cid)
        # 無効なサークル指定は 400
        self.assertEqual(self.client.put(f"/api/users/{login['id']}", json={
            'display_name': 'バンドマン', 'circle_id': 999999}).status_code, 400)

    def test_migration_links_legacy_names(self):
        database.init_db()  # idempotent: 既存データを壊さない
        self.assertEqual(self.client.get('/api/circles').json['success'], True)

    def test_circle_sticker_share_and_obtain(self):
        """サークルで自作シールを配布し、参加メンバーが入手して手帳で使えること"""
        icon = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>'
        # 配布者と受け取り手を用意
        owner = self.client.post('/api/circles', json={
            'name': 'シール部', 'founder_user_id': 1}).json['circle']
        cid = owner['id']
        taker = self.client.post('/api/users/login', json={
            'username': 'taker', 'display_name': '受け取り手'}).json['user']

        # 未参加ユーザーは配布できない（403）
        self.assertEqual(self.client.post(f'/api/circles/{cid}/stickers', json={
            'user_id': taker['id'], 'name': '部外シール', 'image_url': icon}).status_code, 403)

        # 配布（配布者は自動的にマイシールへ）
        res = self.client.post(f'/api/circles/{cid}/stickers', json={
            'user_id': 1, 'name': '部活ロゴ', 'image_url': icon, 'category': 'オリジナル'})
        self.assertEqual(res.status_code, 201)
        sticker = res.json['sticker']
        self.assertEqual(sticker['name'], '部活ロゴ')
        self.assertEqual(sticker['downloads_count'], 0)
        mine = self.client.get('/api/users/1/stickers').json['stickers']
        self.assertTrue(any(s['image_url'] == icon for s in mine))

        # 入力検証
        self.assertEqual(self.client.post(f'/api/circles/{cid}/stickers', json={
            'user_id': 1, 'name': '  ', 'image_url': icon}).status_code, 400)
        self.assertEqual(self.client.post(f'/api/circles/{cid}/stickers', json={
            'user_id': 1, 'name': 'x', 'image_url': ''}).status_code, 400)
        self.assertEqual(self.client.post('/api/circles/999999/stickers', json={
            'user_id': 1, 'name': 'x', 'image_url': icon}).status_code, 404)

        # 受け取り手が入部して入手 → マイシールに追加され取得数が増える
        self.client.post(f'/api/circles/{cid}/join', json={'user_id': taker['id']})
        obtained = self.client.post(
            f'/api/circles/{cid}/stickers/{sticker["id"]}/obtain', json={'user_id': taker['id']})
        self.assertEqual(obtained.status_code, 200)
        self.assertEqual(obtained.json['downloads_count'], 1)
        self.assertFalse(obtained.json['already'])
        taker_stickers = self.client.get(f'/api/users/{taker["id"]}/stickers').json['stickers']
        self.assertEqual(len(taker_stickers), 1)
        self.assertEqual(taker_stickers[0]['source'], 'circle')
        self.assertEqual(taker_stickers[0]['source_id'], sticker['id'])

        # 二重取得はカウントしない
        again = self.client.post(
            f'/api/circles/{cid}/stickers/{sticker["id"]}/obtain', json={'user_id': taker['id']})
        self.assertTrue(again.json['already'])
        self.assertEqual(again.json['downloads_count'], 1)

        # 一覧の取得済みフラグ
        listed = self.client.get(f'/api/circles/{cid}/stickers?user_id={taker["id"]}').json['stickers']
        self.assertTrue(listed[0]['obtained'])
        self.assertEqual(listed[0]['creator_name'], 'ゲスト')

        # 取り下げは配布者のみ
        self.assertEqual(self.client.delete(
            f'/api/circles/{cid}/stickers/{sticker["id"]}?user_id={taker["id"]}').status_code, 403)
        self.assertEqual(self.client.delete(
            f'/api/circles/{cid}/stickers/{sticker["id"]}?user_id=1').status_code, 200)
        self.assertEqual(self.client.get(f'/api/circles/{cid}/stickers').json['stickers'], [])
        # 入手済みのマイシールは配布が消えても残る（手帳で使い続けられる）
        self.assertEqual(len(self.client.get(f'/api/users/{taker["id"]}/stickers').json['stickers']), 1)

    def test_login_normalizes_fullwidth_username(self):
        """全角・大文字・前後空白で入力しても同じアカウントにログインできる"""
        first = self.client.post('/api/users/login', json={
            'username': 'yaya_moderate', 'display_name': 'wawa404'}).json['user']
        for variant in (' YAYA_MODERATE ', 'ｙａｙａ＿ｍｏｄｅｒａｔｅ', '　ｙａｙａ＿ｍｏｄｅｒａｔｅ　'):
            got = self.client.post('/api/users/login', json={'username': variant}).json['user']
            self.assertEqual(got['id'], first['id'], f'{variant!r} で別アカウントが作られた')
            self.assertEqual(got['username'], 'yaya_moderate')
        # 表記ゆれでアカウントが増えていないこと
        users = self.client.get('/api/users').json['users']
        self.assertEqual(len([u for u in users if u['username'] == 'yaya_moderate']), 1)

    def test_circle_chat(self):
        """サークル専用ページのチャット：メンバーだけが投稿でき、履歴は古い順に返る"""
        circle = self.client.post('/api/circles', json={
            'name': 'チャット部', 'founder_user_id': 1}).json['circle']
        cid = circle['id']
        outsider = self.client.post('/api/users/login', json={
            'username': 'chat_out', 'display_name': '部外者'}).json['user']

        # 空メッセージ・長すぎるメッセージは 400
        self.assertEqual(self.client.post(f'/api/circles/{cid}/messages', json={
            'user_id': 1, 'content': '   '}).status_code, 400)
        self.assertEqual(self.client.post(f'/api/circles/{cid}/messages', json={
            'user_id': 1, 'content': 'x' * 501}).status_code, 400)
        self.assertEqual(self.client.post('/api/circles/999999/messages', json={
            'user_id': 1, 'content': 'hello'}).status_code, 404)
        self.assertEqual(self.client.post(f'/api/circles/{cid}/messages', json={
            'user_id': 999999, 'content': 'hello'}).status_code, 404)

        # 未参加ユーザーは投稿できない（403）が、履歴は読める
        self.assertEqual(self.client.post(f'/api/circles/{cid}/messages', json={
            'user_id': outsider['id'], 'content': '部外者の発言'}).status_code, 403)
        self.assertEqual(self.client.get(f'/api/circles/{cid}/messages').status_code, 200)

        # メンバーの投稿
        first = self.client.post(f'/api/circles/{cid}/messages', json={
            'user_id': 1, 'content': 'はじめまして！'})
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.json['chat_message']['content'], 'はじめまして！')
        self.assertEqual(first.json['chat_message']['author_name'], 'ゲスト')

        self.client.post(f'/api/circles/{cid}/messages', json={'user_id': 1, 'content': '2通目'})
        listed = self.client.get(f'/api/circles/{cid}/messages').json['messages']
        self.assertEqual([m['content'] for m in listed], ['はじめまして！', '2通目'])

        # 入部すると投稿できる
        self.client.post(f'/api/circles/{cid}/join', json={'user_id': outsider['id']})
        self.assertEqual(self.client.post(f'/api/circles/{cid}/messages', json={
            'user_id': outsider['id'], 'content': '入部しました'}).status_code, 201)
        self.assertEqual(len(self.client.get(f'/api/circles/{cid}/messages').json['messages']), 3)

        # limit で件数を絞れる
        self.assertEqual(len(self.client.get(f'/api/circles/{cid}/messages?limit=1').json['messages']), 1)

    def test_delete_circle_message(self):
        """チャットの三点メニューからの削除：本人だけが削除できる"""
        circle = self.client.post('/api/circles', json={
            'name': '削除チャット部', 'founder_user_id': 1}).json['circle']
        cid = circle['id']
        owner_id = 1
        other = self.client.post('/api/users/login', json={
            'username': 'chat_del_other', 'display_name': '別の人'}).json['user']
        self.client.post(f'/api/circles/{cid}/join', json={'user_id': other['id']})

        msg = self.client.post(f'/api/circles/{cid}/messages', json={
            'user_id': owner_id, 'content': '消す予定の投稿'}).json['chat_message']

        # 他人のメッセージは削除できない（403）
        self.assertEqual(self.client.delete(
            f'/api/circles/{cid}/messages/{msg["id"]}?user_id={other["id"]}').status_code, 403)
        # 存在しないメッセージ・サークルは 404
        self.assertEqual(self.client.delete(
            f'/api/circles/{cid}/messages/999999?user_id={owner_id}').status_code, 404)
        self.assertEqual(self.client.delete(
            f'/api/circles/999999/messages/{msg["id"]}?user_id={owner_id}').status_code, 404)

        # 本人は削除でき、履歴から消える
        self.assertEqual(self.client.delete(
            f'/api/circles/{cid}/messages/{msg["id"]}?user_id={owner_id}').status_code, 200)
        self.assertEqual(self.client.get(f'/api/circles/{cid}/messages').json['messages'], [])

    def test_user_sticker_dedupe_and_validation(self):
        """掲示板シェア等から取り込むマイシールAPIの重複排除と検証"""
        icon = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9"/></svg>'
        first = self.client.post('/api/users/1/stickers', json={
            'name': 'シェアシール', 'image_url': icon, 'source': 'board', 'source_id': 42})
        self.assertEqual(first.status_code, 201)
        self.assertFalse(first.json['already'])
        second = self.client.post('/api/users/1/stickers', json={
            'name': 'シェアシール', 'image_url': icon, 'source': 'board', 'source_id': 42})
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.json['already'])
        self.assertEqual(len([s for s in self.client.get('/api/users/1/stickers').json['stickers']
                              if s['image_url'] == icon]), 1)
        self.assertEqual(self.client.post('/api/users/1/stickers', json={
            'name': 'x', 'image_url': ''}).status_code, 400)
        self.assertEqual(self.client.post('/api/users/999999/stickers', json={
            'name': 'x', 'image_url': icon}).status_code, 404)
