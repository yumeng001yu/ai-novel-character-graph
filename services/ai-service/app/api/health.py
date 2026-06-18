"""健康检查路由"""

from fastapi import APIRouter

from app.models.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """健康检查接口"""
    return HealthResponse(status="ok", version="0.1.0")
