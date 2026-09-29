# coding=utf-8
"""Packaging for the MakerForge UI plugin for OctoPrint.

Install from inside OctoPrint (Plugin Manager > Get More > "... from an URL"):

    https://github.com/28kearlrusa-spec/Octoprint/archive/refs/heads/main.zip

or with pip, inside the OctoPrint virtualenv:

    pip install https://github.com/28kearlrusa-spec/Octoprint/archive/refs/heads/main.zip
"""
import io
import os
import re

from setuptools import find_packages, setup

HERE = os.path.abspath(os.path.dirname(__file__))

########################################################################################
# Plugin metadata: keep these in sync with `octoprint_makerforge/__init__.py`

plugin_identifier = "makerforge"
plugin_package = "octoprint_makerforge"
plugin_name = "MakerForge UI"


def read_version():
    """Single source of truth for the version lives in the package."""
    with io.open(os.path.join(HERE, plugin_package, "_version.py"), encoding="utf-8") as fh:
        match = re.search(r'__version__\s*=\s*"([^"]+)"', fh.read())
    if not match:
        raise RuntimeError("Unable to find __version__ in _version.py")
    return match.group(1)


def read_readme():
    path = os.path.join(HERE, "README.md")
    if os.path.exists(path):
        with io.open(path, encoding="utf-8") as fh:
            return fh.read()
    return ""


plugin_version = read_version()
plugin_description = (
    "A complete custom control surface for OctoPrint and Klipper, built for Voron-class "
    "printers and styled in the MakerForge look."
)
plugin_author = "MakerForge"
plugin_author_email = ""
plugin_url = "https://github.com/28kearlrusa-spec/Octoprint"
plugin_license = "AGPLv3"

# No third party requirements: everything the plugin needs ships with OctoPrint itself.
plugin_requires = []

setup(
    name="OctoPrint-MakerForge",
    version=plugin_version,
    description=plugin_description,
    long_description=read_readme(),
    long_description_content_type="text/markdown",
    author=plugin_author,
    author_email=plugin_author_email,
    url=plugin_url,
    license=plugin_license,
    packages=find_packages(exclude=["tests", "tests.*", "dev", "dev.*"]),
    include_package_data=True,
    zip_safe=False,
    install_requires=["OctoPrint>=1.9.0"] + plugin_requires,
    python_requires=">=3.7,<4",
    entry_points={"octoprint.plugin": ["{} = {}".format(plugin_identifier, plugin_package)]},
    classifiers=[
        "Environment :: Plugins",
        "Framework :: Flask",
        "Intended Audience :: End Users/Desktop",
        "License :: OSI Approved :: GNU Affero General Public License v3",
        "Programming Language :: JavaScript",
        "Programming Language :: Python :: 3",
        "Topic :: Printing",
    ],
)
