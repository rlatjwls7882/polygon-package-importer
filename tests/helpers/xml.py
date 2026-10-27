"""Serialize ElementTree nodes for the Node DOMParser test double."""
def tree(element):
    return {'tag': element.tag, 'attributes': element.attrib, 'text': element.text or '',
            'children': [tree(child) for child in element]}
