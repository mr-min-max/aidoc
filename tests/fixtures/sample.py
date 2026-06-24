"""
Sample Python module for testing the Python parser.
Contains functions, classes, imports, and type hints.
"""
import os
import json
from typing import Optional, List, Dict
from pathlib import Path


class DataProcessor:
    """Processes raw data and transforms it into structured output."""

    def __init__(self, config: Dict[str, str], verbose: bool = False):
        """Initialize the data processor.

        Args:
            config: Configuration dictionary with processing options.
            verbose: Whether to enable verbose logging.
        """
        self.config = config
        self.verbose = verbose
        self._cache: Dict[str, List[str]] = {}

    def process(self, data: List[str]) -> List[Dict[str, str]]:
        """Process a list of raw data strings.

        Args:
            data: List of raw data strings to process.

        Returns:
            List of processed data dictionaries.
        """
        results = []
        for item in data:
            results.append({"processed": item.strip().lower()})
        return results

    async def process_async(self, data: List[str]) -> List[Dict[str, str]]:
        """Asynchronously process data."""
        return self.process(data)

    def _internal_helper(self) -> None:
        """Internal helper method, not part of public API."""
        pass


def greet_user(name: str, greeting: str = "Hello") -> str:
    """Creates a greeting message for a user.

    Args:
        name: The name of the user.
        greeting: The greeting prefix.

    Returns:
        A formatted greeting string.
    """
    return f"{greeting}, {name}!"


async def fetch_data(url: str, timeout: Optional[int] = None) -> Dict[str, str]:
    """Fetches data from a remote URL.

    Args:
        url: The URL to fetch data from.
        timeout: Optional timeout in seconds.

    Returns:
        A dictionary containing the fetched data.
    """
    return {"url": url, "status": "ok"}


def _internal_function() -> None:
    """This is a private function and should not be exported."""
    pass


class UserService(DataProcessor):
    """Extended service for handling user-specific data."""

    def get_user(self, user_id: int) -> Optional[Dict[str, str]]:
        """Get a user by ID."""
        return None

    def list_users(self) -> List[Dict[str, str]]:
        """List all available users."""
        return []
