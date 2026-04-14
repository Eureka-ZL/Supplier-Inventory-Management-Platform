from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from config import settings
from database import init_db
from routers import auth, orders, suppliers, ai, pmc, pmc_inventory_adjustments

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


from tasks import start_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    logger.info("Starting up application...")
    # Initialize database tables
    await init_db()
    
    # Start background tasks
    start_scheduler()
    
    logger.info("Database initialized and scheduler started")
    yield
    logger.info("Shutting down application...")


# Create FastAPI app
app = FastAPI(
    title="Supplier Gatekeeper System",
    description="供应商交料与管理审核系统 API",
    version="1.0.0",
    lifespan=lifespan,
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(suppliers.router)
app.include_router(orders.router)
app.include_router(ai.router)
app.include_router(pmc.router)
app.include_router(pmc_inventory_adjustments.router)


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Supplier Gatekeeper System API",
        "version": "1.0.0",
        "status": "online",
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=settings.DEBUG)
