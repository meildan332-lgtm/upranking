// api/comment.js

export default async function handler(req, res) {
  // CORS 설정 (OBS 위젯에서 이 서버로 요청할 수 있도록 허용)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. 위젯에서 넘겨준 일반 게시글 주소 가져오기
  const { url } = req.query; 

  if (!url) {
    return res.status(400).json({ error: "URL 파라미터가 필요합니다." });
  }

  try {
    // 2. 게시글 주소에서 '채널명'과 '게시글 번호' 추출
    // 입력 예시: https://www.sooplive.com/station/ecvhao/post/201137725
    // match[1] = ecvhao (채널명)
    // match[2] = 201137725 (게시물 번호)
    const match = url.match(/\/station\/([a-zA-Z0-9_-]+)\/post\/(\d+)/);
    const channelId = match ? match[1] : null;
    const postId = match ? match[2] : null;

    if (!channelId || !postId) {
      return res.status(400).json({ error: "게시글 주소 형식이 올바르지 않습니다. (채널명 또는 게시물 번호를 찾을 수 없음)" });
    }

    // 🎯 3. 찾아내신 SOOP Request URL 완벽 조립
    // page=1 : 첫 페이지 댓글
    // orderBy=reg_date : 등록일순(또는 추천순 정렬 조건이 필요하다면 추후 변경 가능)
    const targetApiUrl = `https://api-channel.sooplive.com/v1.1/channel/${channelId}/post/${postId}/comment?page=1&orderBy=reg_date&cCommentNo=0`;

    // 4. SOOP 서버에 API 요청 (방어막 우회)
    const response = await fetch(targetApiUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': url,
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (!response.ok) {
      throw new Error(`API 요청 실패: ${response.status}`);
    }

    // SOOP 서버가 준 순수 JSON 데이터
    const data = await response.json();

    // 5. 위젯으로 데이터 전달 및 캐싱 설정 (5초 단위 갱신으로 IP 차단 방지)
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate');
    res.status(200).json(data);

  } catch (error) {
    console.error("크롤링 에러:", error);
    res.status(500).json({ error: "서버에서 데이터를 가져오는 중 문제가 발생했습니다." });
  }
}