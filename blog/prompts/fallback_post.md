# 네이버 블로그 게시 (자동 스크립트 실패 시 대체 작업)

자동 게시 스크립트가 실패했습니다. playwright 브라우저 도구로 같은 글을 직접 입력합니다.
브라우저 프로필에는 네이버 로그인이 이미 되어 있습니다.

1. {post_dir}/post.json 을 Read 도구로 읽습니다. 이미지 파일도 같은 폴더에 있습니다
   (thumbnail.png, card1.png ..., photo1.jpg ...).
2. https://blog.naver.com/{blog_id}?Redirect=Write 로 이동합니다.
   "작성 중인 글이 있습니다" 창이 뜨면 취소를 누르고, 도움말 창은 닫습니다.
   로그인 화면이 나오면 아무것도 입력하지 말고 즉시 "로그인 필요"라고 출력하고 끝냅니다.
3. 제목에 title을 입력합니다.
4. 본문 맨 앞에 thumbnail.png 를 넣고, sections 순서대로 입력합니다.
   heading은 굵게, paragraph는 그대로, image는 ref 이름의 파일을 업로드합니다.
   사진(photoN)은 photo_captions의 설명을 사진 설명란에 넣습니다.
5. 모드가 draft면 상단의 저장(임시저장) 버튼만 누릅니다. 발행하지 않습니다.
   모드가 publish면 발행 버튼 → 태그 입력란에 tags 다섯 개 → 발행 확인을 누릅니다.
6. 마지막 화면을 {post_dir}/fallback_result.png 로 스크린샷 찍고,
   draft면 "임시저장 완료", publish면 발행된 글 주소만 출력합니다.

오늘 모드: {mode}
