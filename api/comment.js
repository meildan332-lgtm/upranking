// api/comment.js

export default async function handler(req, res) {
  // CORS 설정 (OBS 위젯에서 이 서버로 요청할 수 있도록 허용)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. 위젯에서 넘겨준 일반 게시글 주소 가져오기
  const url = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  const highlight = Array.isArray(req.query.highlight) ? req.query.highlight[0] : req.query.highlight;

  if (!url) {
    return res.status(400).json({ error: "URL 파라미터가 필요합니다." });
  }

  try {
    // 2. 게시글 주소에서 '채널명'과 '게시글 번호' 추출
    // 입력 예시: https://www.sooplive.com/station/ecvhao/post/201137725
    // match[1] = ecvhao (채널명)
    // match[2] = 201137725 (게시물 번호)
    const cleanUrl = String(url).split('#')[0]; // # 꼬리표 제거
    const match = cleanUrl.match(/\/station\/([a-zA-Z0-9_-]+)\/post\/(\d+)/);
    
    const channelId = match ? match[1] : null;
    const postId = match ? match[2] : null;

    if (!channelId || !postId) {
      return res.status(400).json({ error: "게시글 주소 형식이 올바르지 않습니다. (채널명 또는 게시물 번호를 찾을 수 없음)" });
    }

    // 3. 첫 페이지에서 전체 페이지 수를 확인한 뒤 나머지 페이지를 모두 가져온다.
    // orderBy=like_cnt : 추천수(인기)순 정렬
    // pHighlightNo : 하이라이트할 댓글 번호
    const highlightParam = highlight ? `&pHighlightNo=${encodeURIComponent(highlight)}` : '';
    const apiBase = `https://api-channel.sooplive.com/v1.1/channel/${channelId}/post/${postId}/comment`;
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': cleanUrl,
        'Accept': 'application/json, text/plain, */*'
    };

    const fetchPage = async (page) => {
      const targetApiUrl = `${apiBase}?page=${page}&orderBy=like_cnt&cCommentNo=0${highlightParam}`;
      const response = await fetch(targetApiUrl, { method: 'GET', headers });

      if (!response.ok) {
        const responseText = await response.text();
        console.error(`SOOP API 요청 실패 (${response.status}, page ${page}):`, responseText.slice(0, 500));
        throw new Error(`SOOP API 요청 실패 (${response.status})`);
      }

      return response.json();
    };

    const firstPage = await fetchPage(1);
    const lastPage = Math.max(1, Number(firstPage?.meta?.lastPage) || 1);
    const pages = [firstPage];

    // SOOP에 한꺼번에 너무 많은 요청을 보내지 않도록 5페이지씩 처리한다.
    for (let start = 2; start <= lastPage; start += 5) {
      const pageNumbers = Array.from(
        { length: Math.min(5, lastPage - start + 1) },
        (_, index) => start + index
      );
      pages.push(...await Promise.all(pageNumbers.map(fetchPage)));
    }

    // 베스트/하이라이트 댓글이 여러 페이지에 중복될 수 있어 댓글 번호로 제거한다.
    const commentsById = new Map();
    for (const pageData of pages) {
      for (const comment of (Array.isArray(pageData?.data) ? pageData.data : [])) {
        const key = comment.pCommentNo ?? comment.comment_no ?? comment.id;
        if (key == null || !commentsById.has(String(key))) {
          commentsById.set(key == null ? Symbol() : String(key), comment);
        }
      }
    }

    const data = {
      ...firstPage,
      data: Array.from(commentsById.values()),
      meta: {
        ...(firstPage.meta || {}),
        itemCount: commentsById.size,
        currentPage: 1,
        fetchedPages: lastPage
      }
    };

    // 5. 위젯으로 데이터 전달 및 캐싱 설정 (5초 단위 갱신으로 IP 차단 방지)
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=25');
    res.status(200).json(data);

  } catch (error) {
    console.error("크롤링 에러:", error);
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: "서버에서 데이터를 가져오는 중 문제가 발생했습니다." });
  }
}
